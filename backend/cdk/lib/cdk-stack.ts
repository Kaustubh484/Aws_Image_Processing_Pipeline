import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';
import { Construct } from 'constructs';

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
  });

    // S3 BUCKET
    const fileProcessorBucket = new s3.Bucket(this, 'FileProcessorBucket', {
      bucketName: 'file-process-aws-didu',
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
    });

    // DYNAMODB TABLE
    const fileTable = new dynamodb.Table(this, 'FileTable', {
      tableName: 'FileTable',
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

  const mlClassifierRepo = ecr.Repository.fromRepositoryName(
  this,
  'MlClassifierRepo',
  'ml-classifier'
    );

    // ML LAMBDA IAM ROLE
    const mlLambdaRole = new iam.Role(this, 'MlLambdaProcessorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole'
        ),
      ],
    });

    mlLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject'],
      resources: [`${fileProcessorBucket.bucketArn}/*`],
    }));

    mlLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
      resources: [fileTable.tableArn],
    }));

    // ML LAMBDA — CLASSIFIER (Docker Container)
    const mlClassifierLambda = new lambda.DockerImageFunction(
      this,
      'MlClassifierLambda',
      {
        functionName: 'ml-classifier-lambda',
        code: lambda.DockerImageCode.fromEcr(mlClassifierRepo),
        role: mlLambdaRole,
        environment: {
          BUCKET_NAME: fileProcessorBucket.bucketName,
          TABLE_NAME: fileTable.tableName,
          REGION: this.region,
        },
        timeout: cdk.Duration.minutes(5),
        memorySize: 3008,
      }
    );

    // LAMBDA IAM ROLE (for Lambda 1 and 2)
    const lambdaRole = new iam.Role(this, 'LambdaProcessorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole'
        ),
      ],
    });

    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject', 's3:GetObject'],
      resources: [`${fileProcessorBucket.bucketArn}/*`],
    }));

    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['dynamodb:PutItem', 'dynamodb:GetItem'],
      resources: [fileTable.tableArn],
    }));

    // Lambda 2 needs permission to invoke ML Lambda
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [mlClassifierLambda.functionArn],
    }));

    // LAMBDA 1 — FILE PROCESSOR
    
  const fileProcessorLambda = new lambdaNode.NodejsFunction(
  this,
  'FileProcessorLambda',
  {
    functionName: 'file-processor-lambda',
    entry: path.join(__dirname, '../../lambda/file-processor/index.ts'),
    handler: 'handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    role: lambdaRole,
    projectRoot: path.join(__dirname, '../../lambda/file-processor'),
    depsLockFilePath: path.join(__dirname, '../../lambda/file-processor/package-lock.json'),
    environment: {
      BUCKET_NAME: fileProcessorBucket.bucketName,
      TABLE_NAME: fileTable.tableName,
      REGION: this.region,
    },
    timeout: cdk.Duration.seconds(30),
    bundling: {
      minify: true,
      sourceMap: false,
      externalModules: [],
    },
  }
);
    
    // LAMBDA 2 — STREAM PROCESSOR
   const streamProcessorLambda = new lambdaNode.NodejsFunction(
  this,
  'StreamProcessorLambda',
  {
    functionName: 'stream-processor-lambda',
    entry: path.join(__dirname, '../../lambda/stream-processor/index.ts'),
    handler: 'handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    role: lambdaRole,
    projectRoot: path.join(__dirname, '../../lambda/stream-processor'),
    depsLockFilePath: path.join(__dirname, '../../lambda/stream-processor/package-lock.json'),
    environment: {
      BUCKET_NAME: fileProcessorBucket.bucketName,
      REGION: this.region,
      ML_LAMBDA_NAME: mlClassifierLambda.functionName,
    },
    timeout: cdk.Duration.seconds(30),
    bundling: {
      minify: true,
      sourceMap: false,
      externalModules: [],
    },
  }
);

    // DYNAMODB STREAM to LAMBDA 2 TRIGGER
    
    streamProcessorLambda.addEventSource(
      new lambdaEventSources.DynamoEventSource(fileTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 1,
        filters: [
          lambda.FilterCriteria.filter({
            eventName: lambda.FilterRule.isEqual('INSERT'),
          }),
        ],
      })
    );

    
    // API GATEWAY
    const api = new apigateway.RestApi(this, 'FileProcessorApi', {
      restApiName: 'file-processor-api',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    const lambdaIntegration = new apigateway.LambdaIntegration(
      fileProcessorLambda
    );

    const getUploadUrl = api.root.addResource('get-upload-url');
    getUploadUrl.addMethod('POST', lambdaIntegration);

    const saveRecord = api.root.addResource('save-record');
    saveRecord.addMethod('POST', lambdaIntegration);

    const getResult = api.root.addResource('get-result');
    getResult.addMethod('GET', lambdaIntegration);




// CLOUDFRONT DISTRIBUTION

const frontendDistribution = new cloudfront.Distribution(
  this,
  'FrontendDistribution',
  {
    defaultBehavior: {
      origin: cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(
        frontendBucket
      ),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
    },
    defaultRootObject: 'index.html',
    errorResponses: [
      {
        httpStatus: 403,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
      },
      {
        httpStatus: 404,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
      },
    ],
  }
);



new s3deploy.BucketDeployment(this, 'FrontendDeployment', {
  sources: [s3deploy.Source.asset('../../frontend/dist')],
  destinationBucket: frontendBucket,
  distribution: frontendDistribution,
  distributionPaths: ['/*'],
});
    // OUTPUTS
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL',
    });

    new cdk.CfnOutput(this, 'BucketName', {
      value: fileProcessorBucket.bucketName,
      description: 'S3 Bucket Name',
    });

    new cdk.CfnOutput(this, 'MlClassifierRepoUri', {
      value: mlClassifierRepo.repositoryUri,
      description: 'ECR Repository URI for ML Classifier',
    });
  }
}