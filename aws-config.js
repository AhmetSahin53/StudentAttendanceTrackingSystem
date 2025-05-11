// aws-config.js dosyasını şu şekilde güncelleyin
const { S3Client } = require("@aws-sdk/client-s3")
const { SNSClient } = require("@aws-sdk/client-sns")
const { RDSClient } = require("@aws-sdk/client-rds")

// AWS Region
const AWS_REGION = process.env.AWS_REGION || "us-east-1" // Varsayılan bölge

// AWS Credentials
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY

// S3 Configuration
const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
})

// SNS Configuration
const snsClient = new SNSClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
})

// RDS Configuration
const rdsClient = new RDSClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
})

// S3 Bucket Name
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME 

// SNS Topic ARNs
const SNS_GENERAL_TOPIC_ARN = process.env.SNS_GENERAL_TOPIC_ARN
const SNS_ADMIN_TOPIC_ARN = process.env.SNS_ADMIN_TOPIC_ARN || SNS_GENERAL_TOPIC_ARN
const SNS_DEFAULT_TOPIC_ARN = process.env.SNS_DEFAULT_TOPIC_ARN || SNS_GENERAL_TOPIC_ARN
const SNS_TOPIC_ARN = process.env.SNS_GENERAL_TOPIC_ARN // Geriye dönük uyumluluk için

module.exports = {
  s3Client,
  snsClient,
  rdsClient,
  S3_BUCKET_NAME,
  SNS_TOPIC_ARN,
  SNS_GENERAL_TOPIC_ARN,
  SNS_ADMIN_TOPIC_ARN,
  SNS_DEFAULT_TOPIC_ARN,
  AWS_REGION,
}