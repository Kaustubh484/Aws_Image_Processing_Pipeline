import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { nanoid } from 'nanoid';


// ENVIRONMENT VARIABLES

const BUCKET_NAME = process.env.BUCKET_NAME!;
const TABLE_NAME = process.env.TABLE_NAME!;
const REGION = process.env.REGION!;

// AWS CLIENTS — created outside handler
const s3Client = new S3Client({ region: REGION });
const dynamoClient = new DynamoDBClient({ region: REGION });
const dynamoDocClient = DynamoDBDocumentClient.from(dynamoClient);

// MAIN HANDLER

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {

  const path = event.path;
  const body = JSON.parse(event.body || '{}');

  try {
    if (path === '/get-upload-url') {
      return await getUploadUrl(body.fileName);
    }

    if (path === '/save-record') {
      return await saveRecord(body.inputText, body.inputFilePath);
    }

    if (path === '/get-result') {
      const id = event.queryStringParameters?.id;
      return await getResult(id);
    }

    return {
      statusCode: 404,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Route not found' }),
    };

  } catch (error) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }
};


// JOB 1 — GET PRESIGNED UPLOAD URL

const getUploadUrl = async (
  fileName: string
): Promise<APIGatewayProxyResult> => {

  if (!fileName) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'fileName is required' }),
    };
  }

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: fileName,
  });

  const presignedUrl = await getSignedUrl(s3Client, command, {
    expiresIn: 300,  // URL expires in 5 minutes
  });

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      presignedUrl,
      filePath: `${BUCKET_NAME}/${fileName}`,
    }),
  };
};


// JOB 2 — SAVE RECORD TO DYNAMODB

const saveRecord = async (
  inputText: string,
  inputFilePath: string
): Promise<APIGatewayProxyResult> => {

  if (!inputText || !inputFilePath) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ 
        message: 'inputText and inputFilePath are required' 
      }),
    };
  }

  const id = nanoid();

  await dynamoDocClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      id,
      inputText,
      inputFilePath,
      status: 'PENDING',        // ML job starts as pending
      createdAt: new Date().toISOString(),
    },
  }));

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      success: true,
      id,
    }),
  };
};


// JOB 3 — GET ML RESULT (for polling)

const getResult = async (
  id: string | undefined
): Promise<APIGatewayProxyResult> => {

  if (!id) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'id is required' }),
    };
  }

  const result = await dynamoDocClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { id },
  }));

  if (!result.Item) {
    return {
      statusCode: 404,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Job not found' }),
    };
  }

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      id: result.Item.id,
      status: result.Item.status,
      predictions: result.Item.predictions || null,
      outputFilePath: result.Item.outputFilePath || null,
      completedAt: result.Item.completedAt || null,
    }),
  };
};