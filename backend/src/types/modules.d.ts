declare module 'pdf-parse' {
  interface PDFData {
    numpages: number;
    numrender: number;
    info: any;
    metadata: any;
    text: string;
    version: string;
  }
  
  function pdf(dataBuffer: Buffer, options?: any): Promise<PDFData>;
  export default pdf;
}

declare module 'mammoth' {
  interface ExtractResult {
    value: string;
    message: string;
  }
  
  function extractRawText(options: { path: string }): Promise<ExtractResult>;
  export { extractRawText };
}
