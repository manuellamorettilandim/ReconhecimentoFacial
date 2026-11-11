/**
 * =============================================================================
 * FACE ACCESS - tests/test_server_endpoints.js
 * Teste de Integração das Rotas HTTP da API Express
 * =============================================================================
 */

const assert = require('assert');
const http = require('http');
const { app } = require('../server/index');

const PORTA_TESTE = 3002;
let server;

function requisicao(metodo, rota, payload = null) {
  return new Promise((resolve, reject) => {
    const dadosEnvio = payload ? JSON.stringify(payload) : null;
    const opcoes = {
      hostname: 'localhost',
      port: PORTA_TESTE,
      path: rota,
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        ...(dadosEnvio ? { 'Content-Length': Buffer.byteLength(dadosEnvio) } : {})
      }
    };

    const req = http.request(opcoes, (res) => {
      let corpo = '';
      res.on('data', chunk => corpo += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(corpo);
        } catch {
          // pode ser html
        }
        resolve({ status: res.statusCode, headers: res.headers, corpo, json });
      });
    });

    req.on('error', reject);
    if (dadosEnvio) req.write(dadosEnvio);
    req.end();
  });
}

function gerarRostoMock(variacao = 1.0, escalaY = 0.35) {
  const pontos = [];
  for (let i = 0; i < 478; i++) {
    const theta = (i / 468) * Math.PI * 2;
    const phi = ((i % 50) / 50) * Math.PI - (Math.PI / 2);

    let x = 0.5 + 0.25 * Math.cos(phi) * Math.sin(theta);
    let y = 0.5 + escalaY * Math.sin(phi) * variacao;
    let z = 0.15 * Math.cos(phi) * Math.cos(theta);

    if (i === 33) {
      x = 0.38; y = 0.45; z = 0.05;
    } else if (i === 263) {
      x = 0.62; y = 0.45; z = 0.05;
    } else if (i === 168) {
      x = 0.50; y = 0.48; z = 0.12;
    }

    pontos.push({ x, y, z });
  }
  return pontos;
}

function gerarRostoDiferenteMock() {
  const pontos = [];
  for (let i = 0; i < 478; i++) {
    const theta = (i / 468) * Math.PI * 2;
    const phi = ((i % 50) / 50) * Math.PI - (Math.PI / 2);

    let x = 0.5 + 0.38 * Math.cos(phi) * Math.sin(theta);
    let y = 0.5 + 0.20 * Math.sin(phi);
    let z = 0.28 * Math.cos(phi) * Math.cos(theta);

    if (i === 33) {
      x = 0.30; y = 0.42; z = 0.08;
    } else if (i === 263) {
      x = 0.70; y = 0.42; z = 0.08;
    } else if (i === 168) {
      x = 0.50; y = 0.44; z = 0.20;
    }

    pontos.push({ x, y, z });
  }
  return pontos;
}

async function rodarTestesIntegracao() {
  console.log('Iniciando servidor de teste na porta', PORTA_TESTE, '...');
  server = app.listen(PORTA_TESTE);

  try {
    // 1. Testa rotas estáticas
    console.log('-> Testando entrega das páginas HTML...');
    const rIndex = await requisicao('GET', '/');
    assert.strictEqual(rIndex.status, 200);
    assert(rIndex.corpo.includes('Face Access'));

    const rCadastro = await requisicao('GET', '/cadastro.html');
    assert.strictEqual(rCadastro.status, 200);

    const rPessoas = await requisicao('GET', '/pessoas.html');
    assert.strictEqual(rPessoas.status, 200);

    const rCalibracao = await requisicao('GET', '/calibracao.html');
    assert.strictEqual(rCalibracao.status, 200);
    console.log('   [OK] Todas as páginas HTML respondem status 200.\n');

    // 2. Testa GET e PUT /config
    console.log('-> Testando endpoints de configuração...');
    const rConfig = await requisicao('GET', '/config');
    assert.strictEqual(rConfig.status, 200);
    assert.strictEqual(rConfig.json.versaoModelo, 'mediapipe-pontos-estaveis-v2');

    const rPutConfig = await requisicao('PUT', '/config', { limiar: 0.045 });
    assert.strictEqual(rPutConfig.status, 200);
    assert.strictEqual(rPutConfig.json.config.limiar, 0.045);
    console.log('   [OK] Configuração lida e atualizada com sucesso.\n');

    // 3. Testa POST /cadastrar com erro de consentimento
    console.log('-> Testando validação de consentimento LGPD...');
    const rErroConsentimento = await requisicao('POST', '/cadastrar', {
      nome: 'Teste Sem Consentimento',
      consentimento: false,
      capturas: [gerarRostoMock(), gerarRostoMock(), gerarRostoMock(), gerarRostoMock(), gerarRostoMock()]
    });
    assert.strictEqual(rErroConsentimento.status, 400);
    console.log('   [OK] Tentativa sem consentimento rejeitada com status 400.\n');

    // 4. Testa POST /cadastrar com sucesso
    console.log('-> Testando cadastro de nova pessoa...');
    const rostoBase = gerarRostoMock(1.0);
    const capturasValidas = [
      rostoBase,
      gerarRostoMock(1.01),
      gerarRostoMock(1.02),
      gerarRostoMock(0.99),
      rostoBase
    ];

    const rCadastroSucesso = await requisicao('POST', '/cadastrar', {
      nome: 'Aluno de Teste',
      consentimento: true,
      capturas: capturasValidas
    });
    assert.strictEqual(rCadastroSucesso.status, 201);
    assert(rCadastroSucesso.json.sucesso);
    const idCadastrado = rCadastroSucesso.json.pessoa.id;
    assert(idCadastrado);
    console.log('   [OK] Pessoa cadastrada com sucesso. ID:', idCadastrado, '\n');

    // 5. Testa GET /pessoas (garante minimização da LGPD - sem vetores)
    console.log('-> Testando listagem pública GET /pessoas...');
    const rListaPessoas = await requisicao('GET', '/pessoas');
    assert.strictEqual(rListaPessoas.status, 200);
    const pessoaNaLista = rListaPessoas.json.find(p => p.id === idCadastrado);
    assert(pessoaNaLista);
    assert.strictEqual(pessoaNaLista.embeddings, undefined, 'Embeddings NÃO devem ser expostos na listagem pública!');
    assert.strictEqual(pessoaNaLista.media, undefined, 'Vetor médio NÃO deve ser exposto na listagem pública!');
    console.log('   [OK] Listagem pública em conformidade com minimização LGPD.\n');

    // 6. Testa POST /verificar com o mesmo rosto
    console.log('-> Testando verificação biométrica POST /verificar...');
    const rVerificar = await requisicao('POST', '/verificar', {
      landmarks: rostoBase
    });
    assert.strictEqual(rVerificar.status, 200);
    console.log('   Resultado verificação (rosto cadastrado):', {
      nome: rVerificar.json.nome,
      distancia: rVerificar.json.distancia,
      passou: rVerificar.json.passou
    });
    assert.strictEqual(rVerificar.json.passou, true, 'O mesmo rosto deve passar no teste biométrico.');
    assert.strictEqual(rVerificar.json.pessoaId, idCadastrado);
    assert.strictEqual(rVerificar.json.nome, 'Aluno de Teste');
    console.log('   [OK] Verificação biométrica aprovada.\n');

    // 6b. Testa POST /verificar com rosto NÃO CADASTRADO
    console.log('-> Testando verificação com rosto NÃO CADASTRADO...');
    const rostoNaoCadastrado = gerarRostoDiferenteMock(); // Rosto com anatomia e feições distintas
    const rVerificarNaoCadastrado = await requisicao('POST', '/verificar', {
      landmarks: rostoNaoCadastrado
    });
    assert.strictEqual(rVerificarNaoCadastrado.status, 200);
    console.log('   Resultado verificação (rosto não cadastrado):', {
      nome: rVerificarNaoCadastrado.json.nome,
      distancia: rVerificarNaoCadastrado.json.distancia,
      passou: rVerificarNaoCadastrado.json.passou
    });
    assert.strictEqual(rVerificarNaoCadastrado.json.passou, false);
    assert.strictEqual(rVerificarNaoCadastrado.json.pessoaId, null);
    assert.strictEqual(rVerificarNaoCadastrado.json.nome, 'Pessoa Não Cadastrada');
    console.log('   [OK] Rosto não cadastrado identificado como "Pessoa Não Cadastrada".\n');

    // 7. Testa DELETE /pessoas/:id
    console.log('-> Testando exclusão de pessoa DELETE /pessoas/:id...');
    const rDelete = await requisicao('DELETE', `/pessoas/${idCadastrado}`);
    assert.strictEqual(rDelete.status, 200);
    assert.strictEqual(rDelete.json.sucesso, true);

    const rChecaExclusao = await requisicao('GET', '/pessoas');
    const checaPessoa = rChecaExclusao.json.find(p => p.id === idCadastrado);
    assert.strictEqual(checaPessoa, undefined, 'Pessoa deve ter sido excluída.');
    console.log('   [OK] Pessoa excluída com sucesso da base.\n');

    console.log('================================================================');
    console.log('TODOS OS TESTES DE INTEGRAÇÃO HTTP PASSARAM COM 100% DE SUCESSO!');
    console.log('================================================================');
  } finally {
    if (server) {
      server.close(() => {
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  }
}

rodarTestesIntegracao().catch(err => {
  console.error('Falha nos testes de integração:', err);
  if (server) server.close();
  process.exit(1);
});
