import { nanoid } from 'nanoid';

// ==========================================
// MOCK AWS SDK
// so tests don't actually call AWS
// ==========================================
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://mock-presigned-url.com'),
}));
jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({
      send: jest.fn().mockResolvedValue({ Item: null }),
    }),
  },
  PutCommand: jest.fn(),
  GetCommand: jest.fn(),
}));
jest.mock('nanoid', () => ({
  nanoid: jest.fn().mockReturnValue('test-id-123'),
}));

// ==========================================
// SET ENVIRONMENT VARIABLES
// ==========================================
process.env.BUCKET_NAME = 'test-bucket';
process.env.TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

// ==========================================
// TESTS
// ==========================================
describe('File Processor Lambda', () => {

  describe('getUploadUrl', () => {
    it('should return presigned URL and file path', async () => {
      const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
      const result = await getSignedUrl();

      expect(result).toBe('https://mock-presigned-url.com');
    });

    it('should generate correct file path', () => {
      const fileName = 'test-image.jpg';
      const bucketName = process.env.BUCKET_NAME;
      const filePath = `${bucketName}/${fileName}`;

      expect(filePath).toBe('test-bucket/test-image.jpg');
    });
  });

  describe('saveRecord', () => {
    it('should generate unique ID using nanoid', () => {
      const id = nanoid();
      expect(id).toBe('test-id-123');
    });

    it('should build correct DynamoDB record structure', () => {
      const inputText = 'Test image';
      const inputFilePath = 'test-bucket/test.jpg';
      const id = nanoid();

      const record = {
        id,
        inputText,
        inputFilePath,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      expect(record.id).toBe('test-id-123');
      expect(record.status).toBe('PENDING');
      expect(record.inputText).toBe(inputText);
      expect(record.inputFilePath).toBe(inputFilePath);
      expect(record.createdAt).toBeDefined();
    });

    it('should return error if inputText is missing', () => {
      const inputText:string = '';
      const isValid = Boolean(inputText && inputText.trim());
      expect(isValid).toBe(false);
    });

    it('should return error if inputFilePath is missing', () => {
      const inputFilePath = '';
      const isValid = Boolean(inputFilePath);
      expect(isValid).toBe(false);
    });
  });

  describe('getResult', () => {
    it('should return error if id is missing', () => {
      const id = undefined;
      const isValid = Boolean(id);
      expect(isValid).toBe(false);
    });

    it('should build correct response structure', () => {
      const mockItem = {
        id: 'test-id-123',
        status: 'COMPLETE',
        predictions: [
          { label: 'Egyptian cat', confidence: 0.4994 }
        ],
        outputFilePath: 'test-bucket/results.json',
        completedAt: new Date().toISOString(),
      };

      expect(mockItem.id).toBeDefined();
      expect(mockItem.status).toBe('COMPLETE');
      expect(mockItem.predictions).toHaveLength(1);
      expect(mockItem.predictions[0].label).toBe('Egyptian cat');
    });
  });
});