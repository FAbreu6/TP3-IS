import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;

export function initSupabase(url: string, serviceRoleKey: string): void {
  supabaseClient = createClient(url, serviceRoleKey);
}

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    throw new Error('Supabase client not initialized. Call initSupabase first.');
  }
  return supabaseClient;
}

export interface FileInfo {
  name: string;
  id: string;
  updated_at: string;
  created_at: string;
}

/**
 * Lista todos os ficheiros CSV no prefixo especificado do bucket
 */
export async function listFiles(
  bucketName: string,
  prefix: string,
  limit: number = 500
): Promise<FileInfo[]> {
  const client = getSupabaseClient();
  
  const { data, error } = await client.storage
    .from(bucketName)
    .list(prefix, {
      limit,
      sortBy: { column: 'created_at', order: 'desc' }
    });

  if (error) {
    throw new Error(`Failed to list files: ${error.message}`);
  }

  if (!data) {
    return [];
  }

  // Filtrar apenas ficheiros CSV
  return data
    .filter(file => file.name.endsWith('.csv'))
    .map(file => ({
      name: file.name,
      id: file.id,
      updated_at: file.updated_at || file.created_at || '',
      created_at: file.created_at || ''
    }));
}

/**
 * Faz download de um ficheiro do bucket
 */
export async function downloadFile(
  bucketName: string,
  filePath: string
): Promise<Buffer> {
  const client = getSupabaseClient();
  
  const { data, error } = await client.storage
    .from(bucketName)
    .download(filePath);

  if (error) {
    throw new Error(`Failed to download file: ${error.message}`);
  }

  if (!data) {
    throw new Error('Download returned no data');
  }

  // Converter Blob para Buffer
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Faz upload de um ficheiro para o bucket
 */
export async function uploadFile(
  bucketName: string,
  filePath: string,
  content: Buffer | string,
  contentType: string = 'text/csv'
): Promise<void> {
  const client = getSupabaseClient();
  
  const { error } = await client.storage
    .from(bucketName)
    .upload(filePath, content, {
      contentType,
      upsert: true // Substituir se já existir
    });

  if (error) {
    throw new Error(`Failed to upload file: ${error.message}`);
  }
}

/**
 * Deleta um ficheiro do bucket
 */
export async function deleteFile(
  bucketName: string,
  filePath: string
): Promise<void> {
  const client = getSupabaseClient();
  
  const { error } = await client.storage
    .from(bucketName)
    .remove([filePath]);

  if (error) {
    throw new Error(`Failed to delete file: ${error.message}`);
  }
}
