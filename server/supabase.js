/**
 * =============================================================================
 * FACE ACCESS - server/supabase.js
 * Cliente de Integração com o Banco de Dados Supabase
 * =============================================================================
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

// Permite conexões em redes corporativas/acadêmicas (ex: FECAP) que usam proxy SSL com restrição de revogação
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let rawUrl = (process.env.SUPABASE_URL || '').trim();
// Remove automaticamente /rest/v1 ou barras extras ao final da URL
const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');

const supabaseKey = process.env.SUPABASE_SECRET_KEY ||
                    process.env.SUPABASE_SERVICE_ROLE_KEY || 
                    process.env.SUPABASE_ANON_KEY || 
                    process.env.SUPABASE_KEY;

let supabase = null;

if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    });
    console.log('[SUPABASE] Conexão inicializada com sucesso:', supabaseUrl);
  } catch (erro) {
    console.error('[SUPABASE] Falha ao instanciar cliente:', erro.message);
  }
} else {
  console.log('[SUPABASE] Nenhuma credencial encontrada no .env. Operando em modo de fallback local.');
}

function obterSupabase() {
  return supabase;
}

function isSupabaseConfigurado() {
  return !!supabase;
}

module.exports = {
  obterSupabase,
  isSupabaseConfigurado
};
