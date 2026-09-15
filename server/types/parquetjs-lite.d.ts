declare module "parquetjs-lite" {
  export type ParquetCursor = { next(): Promise<Record<string, unknown> | null> };
  export type ParquetReaderInstance = { getCursor(): ParquetCursor; close(): Promise<void> };
  const parquet: { ParquetReader: { openBuffer(input: Buffer): Promise<ParquetReaderInstance> } };
  export default parquet;
}
