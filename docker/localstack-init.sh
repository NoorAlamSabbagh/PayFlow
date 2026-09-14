#!/usr/bin/env bash
echo "Initializing LocalStack AWS SQS resources for PayFlow..."

awslocal sqs create-queue \
  --queue-name payflow-transaction-events.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=true

awslocal sqs create-queue \
  --queue-name payflow-notifications

echo "SQS Queues initialized successfully:"
awslocal sqs list-queues
