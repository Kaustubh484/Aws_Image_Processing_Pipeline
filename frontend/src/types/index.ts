export interface UploadUrlRequest {
  fileName: string;
}

export interface UploadUrlResponse {
  presignedUrl: string;
  filePath: string;
}

export interface SaveRecordRequest {
  inputText: string;
  inputFilePath: string;
}

export interface SaveRecordResponse {
  success: boolean;
  id: string;
}

export interface Prediction {
  label: string;
  confidence: number;
}

export interface JobResult {
  id: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETE' | 'FAILED';
  predictions: Prediction[] | null;
  outputFilePath: string | null;
  completedAt: string | null;
}

export type SubmitStatus =
  | 'idle'
  | 'getting-url'
  | 'uploading'
  | 'saving'
  | 'processing'
  | 'complete'
  | 'error';