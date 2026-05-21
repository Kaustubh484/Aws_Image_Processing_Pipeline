import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ==========================================
    // S3 BUCKET
    // ==========================================
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

    // ==========================================
    // DYNAMODB TABLE
    // ==========================================
    const fileTable = new dynamodb.Table(this, 'FileTable', {
      tableName: 'FileTable',
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // ==========================================
    // IAM ROLE FOR EC2
    // ==========================================
    const ec2Role = new iam.Role(this, 'Ec2ProcessorRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'Role for EC2 file processing instances',
    });

    ec2Role.addToPolicy(new iam.PolicyStatement({
      actions: [
        's3:GetObject',
        's3:PutObject',
      ],
      resources: [`${fileProcessorBucket.bucketArn}/*`],
    }));

    ec2Role.addToPolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem',
        'dynamodb:UpdateItem',
      ],
      resources: [fileTable.tableArn],
    }));

    ec2Role.addToPolicy(new iam.PolicyStatement({
      actions: [
        'ec2:TerminateInstances',
        'ec2:DescribeInstances',
      ],
      resources: ['*'],
    }));

    // ==========================================
    // EC2 INSTANCE PROFILE
    // ==========================================
    const ec2InstanceProfile = new iam.CfnInstanceProfile(this, 'Ec2InstanceProfile', {
      roles: [ec2Role.roleName],
    });

    // ==========================================
    // IAM ROLE FOR LAMBDA
    // ==========================================
    const lambdaRole = new iam.Role(this, 'LambdaProcessorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
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

    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'ec2:RunInstances',
        'ec2:DescribeInstances',
        'iam:PassRole',
      ],
      resources: ['*'],
    }));

    // ==========================================
    // LAMBDA 1 — FILE PROCESSOR
    // ==========================================
    const fileProcessorLambda = new lambda.Function(this, 'FileProcessorLambda', {
      functionName: 'file-processor-lambda',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../lambda/file-processor'),
      role: lambdaRole,
      environment: {
        BUCKET_NAME: fileProcessorBucket.bucketName,
        TABLE_NAME: fileTable.tableName,
        REGION: this.region,
      },
      timeout: cdk.Duration.seconds(30),
    });

    // ==========================================
    // LAMBDA 2 — STREAM PROCESSOR
    // ==========================================
    const streamProcessorLambda = new lambda.Function(this, 'StreamProcessorLambda', {
      functionName: 'stream-processor-lambda',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../lambda/stream-processor'),
      role: lambdaRole,
      environment: {
        BUCKET_NAME: fileProcessorBucket.bucketName,
        REGION: this.region,
        INSTANCE_PROFILE_ARN: ec2InstanceProfile.attrArn,
      },
      timeout: cdk.Duration.seconds(30),
    });

    // ==========================================
    // DYNAMODB STREAM → LAMBDA 2 TRIGGER
    // ==========================================
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

    // ==========================================
    // API GATEWAY
    // ==========================================
    const api = new apigateway.RestApi(this, 'FileProcessorApi', {
      restApiName: 'file-processor-api',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    const lambdaIntegration = new apigateway.LambdaIntegration(fileProcessorLambda);

    const getUploadUrl = api.root.addResource('get-upload-url');
    getUploadUrl.addMethod('POST', lambdaIntegration);

    const saveRecord = api.root.addResource('save-record');
    saveRecord.addMethod('POST', lambdaIntegration);

    // ==========================================
    // UPLOAD EC2 SCRIPT TO S3
    // ==========================================
    new s3deploy.BucketDeployment(this, 'DeployProcessingScript', {
      sources: [s3deploy.Source.asset('../scripts')],
      destinationBucket: fileProcessorBucket,
    });

    // ==========================================
    // OUTPUTS
    // ==========================================
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL',
    });

    new cdk.CfnOutput(this, 'BucketName', {
      value: fileProcessorBucket.bucketName,
      description: 'S3 Bucket Name',
    });
  }
}