/**
 * =============================================================================
 * Script de Migração: data/pessoas.json -> Supabase
 * Execução: node scripts/migrar_para_supabase.js
 * =============================================================================
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const { obterSupabase, isSupabaseConfigurado } = require('../server/supabase');

async function migrar() {
  console.log('--- INICIANDO MIGRAÇÃO PARA O SUPABASE ---');

  if (!isSupabaseConfigurado()) {
    console.error('❌ Supabase não configurado no .env!');
    process.exit(1);
  }

  const supabase = obterSupabase();
  const caminhoJson = path.join(__dirname, '..', 'data', 'pessoas.json');

  if (!fs.existsSync(caminhoJson)) {
    console.log('Nenhum arquivo data/pessoas.json encontrado.');
    return;
  }

  const pessoas = JSON.parse(fs.readFileSync(caminhoJson, 'utf-8'));
  console.log(`Encontradas ${pessoas.length} pessoas no arquivo local.`);

  let migrados = 0;
  let erros = 0;

  for (const p of pessoas) {
    if (!p.nome || (!p.media && !p.embeddings)) {
      console.warn(`Pessoa ignorada por dados incompletos: ${p.nome || 'Sem nome'}`);
      continue;
    }

    const vetor = Array.isArray(p.media) ? p.media : (Array.isArray(p.embeddings) ? p.embeddings[0] : null);
    if (!vetor) continue;

    const registro = {
      nome: p.nome.trim(),
      embedding: vetor,
      timerstamp: p.criadoEm || new Date().toISOString(),
      softdelet: false,
      delete_at: null
    };

    const { error } = await supabase
      .from('pessoas')
      .insert(registro);

    if (error) {
      console.error(`❌ Erro ao migrar "${p.nome}":`, error.message);
      erros++;
    } else {
      console.log(`✅ Migrado: "${p.nome}"`);
      migrados++;
    }
  }

  console.log(`\n🎉 Migração concluída! Sucessos: ${migrados} | Falhas: ${erros}`);
}

migrar();
