import axios from 'axios';
import type {
  UploadUrlResponse,
  SaveRecordResponse,
  JobResult,
} from '../types';

// BASE URL — from environment variable
// never hardcoded
const API_BASE_URL = import.meta.env.VITE_API_URL;

// JOB 1 — GET PRESIGNED UPLOAD URL
export const getUploadUrl = async (
  fileName: string
): Promise<UploadUrlResponse> => {
  const response = await axios.post<UploadUrlResponse>(
    `${API_BASE_URL}/get-upload-url`,
    { fileName }
  );
  return response.data;
};

// JOB 2 — UPLOAD FILE DIRECTLY TO S3
// uses presigned URL — never goes through Lambda
export const uploadFileToS3 = async (
  presignedUrl: string,
  file: File
): Promise<void> => {
  await axios.put(presignedUrl, file, {
    headers: {
      'Content-Type': file.type,
    },
  });
};

// JOB 3 — SAVE RECORD TO DYNAMODB
export const saveRecord = async (
  inputText: string,
  inputFilePath: string
): Promise<SaveRecordResponse> => {
  const response = await axios.post<SaveRecordResponse>(
    `${API_BASE_URL}/save-record`,
    { inputText, inputFilePath }
  );
  return response.data;
};

// JOB 4 — GET RESULT FOR A JOB
export const getResult = async (id: string): Promise<JobResult> => {
  const response = await axios.get<JobResult>(
    `${API_BASE_URL}/get-result`,
    { params: { id } }
  );
  return response.data;
};

// JOB 5 — POLL FOR RESULT
// checks every 5 seconds until complete
// maximum 24 attempts (2 minutes)
export const pollForResult = async (
  id: string,
  onStatusUpdate: (status: string) => void
): Promise<JobResult> => {

  const MAX_ATTEMPTS = 48;
  const INTERVAL_MS = 5000;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {

    // Wait 5 seconds between each check
    await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));

    const result = await getResult(id);
    onStatusUpdate(result.status);

    if (result.status === 'COMPLETE') {
      return result;
    }

    if (result.status === 'FAILED') {
      throw new Error('Classification job failed');
    }
  }

  throw new Error('Job timed out after 2 minutes');
};