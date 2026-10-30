export { createObjectStorageClient, type ObjectStorageClientConfig } from './s3-client.js';
export {
  MULTIPART_PART_BYTES,
  ObjectMissingError,
  ObjectTooLargeError,
  putStreamMultipart,
  S3ObjectStorage,
  type ListedObject,
  type ObjectHead,
  type ObjectStorage,
  type PresignedPut,
  type S3ObjectStorageOptions,
} from './object-storage.js';
