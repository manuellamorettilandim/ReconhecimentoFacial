/**
 * =============================================================================
 * Teste Rápido de Conexão com o Supabase
 * Execução: node tests/test_supabase_connection.js (ou npm.cmd run test:supabase)
 * =============================================================================
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { obterSupabase, isSupabaseConfigurado } = require('../server/supabase');

async function testarConexao() {
  console.log('--- TESTE DE CONEXÃO SUPABASE ---');
  
  if (!isSupabaseConfigurado()) {
    console.error('❌ Supabase não configurado no .env!');
    console.log('Certifique-se de que o .env possui:');
    console.log('SUPABASE_URL=https://oavqwmbacrideckuumoe.supabase.co');
    console.log('SUPABASE_SECRET_KEY=sb_secret_...');
    process.exit(1);
  }

  const supabase = obterSupabase();
  console.log('🔗 Conectando ao Supabase em:', process.env.SUPABASE_URL);

  try {
    const { data, error } = await supabase
      .from('pessoas')
      .select('*')
      .limit(5);

    if (error) {
      console.error('❌ Erro retornado pelo Supabase:', error.message);
      process.exit(1);
    }

    console.log('✅ Conexão com Supabase estabelecida com sucesso!');
    console.log(`📊 Tabela "pessoas" acessível. Registros encontrados: ${data.length}`);
    
    // Testa se as colunas requisitadas estão presentes
    const colunasEsperadas = ['nome', 'embedding', 'timerstamp', 'softdelet', 'delete_at'];
    const testRow = await supabase.from('pessoas').select('nome, embedding, timerstamp, softdelet, delete_at').limit(1);
    
    if (testRow.error) {
      console.warn('\n⚠️  Atenção: A tabela "pessoas" no Supabase ainda está com o schema anterior.');
      console.warn('Para ativar as colunas exatas (nome, embedding, timerstamp, softdelet, delete_at),');
      console.warn('execute o comando SQL no Supabase SQL Editor.');
    } else {
      console.log('🎯 Todas as colunas requisitadas (nome, embedding, timerstamp, softdelet, delete_at) estão prontas!');
    }
  } catch (err) {
    console.error('❌ Exceção na conexão:', err.message);
    process.exit(1);
  }
}

testarConexao();
