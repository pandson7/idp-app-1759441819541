import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';

export class TestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Simple S3 bucket for testing
    const testBucket = new s3.Bucket(this, 'TestBucket', {
      bucketName: `test-bucket-1759441819541`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    new cdk.CfnOutput(this, 'TestBucketName', {
      value: testBucket.bucketName,
      description: 'Test S3 bucket name',
    });
  }
}
