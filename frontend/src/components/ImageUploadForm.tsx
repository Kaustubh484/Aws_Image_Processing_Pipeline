import { useState } from 'react';
import type { SubmitStatus, Prediction } from '../types';
import {
  getUploadUrl,
  uploadFileToS3,
  saveRecord,
  pollForResult,
} from '../services/api';
import PredictionResults from './PredictionResults';

// ==========================================
// ACCEPTED IMAGE TYPES
// ==========================================
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/jpg'];

const ImageUploadForm = () => {
  // ==========================================
  // STATE
  // ==========================================
  const [inputText, setInputText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  
const [predictions, setPredictions] = useState<Prediction[] | null>(null);

  // ==========================================
  // FILE VALIDATION
  // ==========================================
  const validateFile = (selectedFile: File): boolean => {
    if (!ACCEPTED_TYPES.includes(selectedFile.type)) {
      setErrorMessage('Please upload a JPG or PNG image');
      return false;
    }
    if (selectedFile.size > 10 * 1024 * 1024) {
      setErrorMessage('File size must be under 10MB');
      return false;
    }
    return true;
  };

  // ==========================================
  // FILE CHANGE HANDLER
  // ==========================================
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (validateFile(selectedFile)) {
      setFile(selectedFile);
      setErrorMessage('');
    }
  };

  // ==========================================
  // SUBMIT HANDLER
  // ==========================================
  const handleSubmit = async () => {
    // Validate inputs
    if (!inputText.trim()) {
      setErrorMessage('Please enter a description');
      return;
    }
    if (!file) {
      setErrorMessage('Please select an image');
      return;
    }

    setErrorMessage('');
    setPredictions(null);

    try {
      // Step 1 — Get presigned URL
      setStatus('getting-url');
      const { presignedUrl, filePath } = await getUploadUrl(file.name);

      // Step 2 — Upload file directly to S3
      setStatus('uploading');
      await uploadFileToS3(presignedUrl, file);

      // Step 3 — Save record to DynamoDB
      setStatus('saving');
      const { id } = await saveRecord(inputText, filePath);

      // Step 4 — Poll for ML results
      setStatus('processing');
      const result = await pollForResult(id, (currentStatus) => {
        console.log('Job status:', currentStatus);
      });

      // Step 5 — Show results
      setPredictions(result.predictions);
      setStatus('complete');

    } catch (error) {
      console.error('Submit error:', error);
      setErrorMessage('Something went wrong. Please try again.');
      setStatus('error');
    }
  };

  // ==========================================
  // STATUS MESSAGE
  // ==========================================
  const getStatusMessage = (): string => {
    switch (status) {
      case 'getting-url':   return 'Preparing upload...';
      case 'uploading':     return 'Uploading image to S3...';
      case 'saving':        return 'Creating classification job...';
      case 'processing':    return 'AI is classifying your image...';
      case 'complete':      return 'Classification complete!';
      case 'error':         return errorMessage;
      default:              return '';
    }
  };

  // ==========================================
  // RENDER
  // ==========================================
  return (
    <div className="form-container">
      <h1>Image Classifier</h1>
      <p>Upload an image and our AI will classify it using ResNet50</p>

      {/* Description Input */}
      <div className="form-group">
        <label htmlFor="description">Description</label>
        <input
          id="description"
          type="text"
          placeholder="e.g. My dog photo"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          disabled={status !== 'idle' && status !== 'error'}
        />
      </div>

      {/* File Input */}
      <div className="form-group">
        <label htmlFor="image">Image</label>
        <input
          id="image"
          type="file"
          accept=".jpg,.jpeg,.png"
          onChange={handleFileChange}
          disabled={status !== 'idle' && status !== 'error'}
        />
        {file && (
          <p className="file-name">Selected: {file.name}</p>
        )}
      </div>

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={status !== 'idle' && status !== 'error'}
        className="submit-button"
      >
        {status === 'processing' ? 'Processing...' : 'Classify Image'}
      </button>

      {/* Status Message */}
      {status !== 'idle' && (
        <p className={`status-message ${status}`}>
          {getStatusMessage()}
        </p>
      )}

      {/* Results */}
      {status === 'complete' && predictions && (
        <PredictionResults predictions={predictions} />
      )}
    </div>
  );
};

export default ImageUploadForm;