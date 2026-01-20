import * as fs from 'fs';
import * as path from 'path';

export interface ProcessorState {
  last_processed_filename: string | null;
  processed_at_utc: string | null;
}

const STATE_FILE = path.join(__dirname, '..', 'state.json');

/**
 * Carrega o estado persistente do processador
 */
export function loadState(): ProcessorState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const content = fs.readFileSync(STATE_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('Error loading state:', error);
  }

  // Estado inicial
  return {
    last_processed_filename: null,
    processed_at_utc: null
  };
}

/**
 * Salva o estado persistente do processador
 */
export function saveState(state: ProcessorState): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error saving state:', error);
    throw error;
  }
}

/**
 * Atualiza o estado com o novo ficheiro processado
 */
export function updateState(filename: string): void {
  const state: ProcessorState = {
    last_processed_filename: filename,
    processed_at_utc: new Date().toISOString()
  };
  saveState(state);
}
