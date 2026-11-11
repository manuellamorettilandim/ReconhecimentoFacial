/**
 * =============================================================================
 * FACE ACCESS - public/js/pessoas.js
 * Gerenciamento e Exclusão de Cadastros Biométricos
 * =============================================================================
 */

const tabelaPessoasCorpo = document.getElementById('tabelaPessoasCorpo');

/**
 * Formata data no formato brasileiro legível
 */
function formatarData(isoString) {
  if (!isoString) return '--';
  try {
    const d = new Date(isoString);
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return isoString;
  }
}

/**
 * Carrega e renderiza a lista de pessoas
 */
async function carregarPessoas() {
  try {
    const resposta = await fetch('/pessoas');
    if (!resposta.ok) {
      throw new Error(`Erro na rota /pessoas (${resposta.status})`);
    }

    const pessoas = await resposta.json();
    renderizarTabela(pessoas);
  } catch (erro) {
    console.error('[PESSOAS] Erro ao carregar lista:', erro);
    tabelaPessoasCorpo.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; color: var(--danger); padding: 3rem;">
          ❌ Erro ao buscar dados de pessoas cadastradas: ${erro.message}
        </td>
      </tr>
    `;
  }
}

/**
 * Renderiza os registros na tabela HTML
 * @param {Array<object>} pessoas 
 */
function renderizarTabela(pessoas) {
  if (!pessoas || pessoas.length === 0) {
    tabelaPessoasCorpo.innerHTML = `
      <tr>
        <td colspan="5">
          <div class="empty-state">
            <div class="empty-icon">👥</div>
            <h3>Nenhuma pessoa cadastrada no sistema</h3>
            <p style="margin: 0.5rem 0 1.5rem 0;">Cadastre um rosto para testar o reconhecimento e calibração.</p>
            <a href="cadastro.html" class="btn btn-primary">
              Cadastrar Primeiro Rosto
            </a>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tabelaPessoasCorpo.innerHTML = '';

  pessoas.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight: 700; color: #fff; font-size: 1.1rem;">${escapeHtml(p.nome)}</td>
      <td><code style="background: rgba(0,0,0,0.3); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.85rem; color: var(--accent-cyan);">${escapeHtml(p.id)}</code></td>
      <td>${formatarData(p.criadoEm)}</td>
      <td><span style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; padding: 0.2rem 0.6rem; border-radius: 999px; font-size: 0.8rem; font-weight: 600;">${escapeHtml(p.versaoModelo)}</span></td>
      <td style="text-align: right;">
        <button class="btn btn-danger btn-excluir" data-id="${p.id}" data-nome="${escapeHtml(p.nome)}" style="padding: 0.45rem 0.9rem; font-size: 0.9rem;">
          🗑️ Excluir
        </button>
      </td>
    `;
    tabelaPessoasCorpo.appendChild(tr);
  });

  // Associa eventos de exclusão aos botões
  document.querySelectorAll('.btn-excluir').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = btn.getAttribute('data-id');
      const nome = btn.getAttribute('data-nome');
      await confirmarEExcluir(id, nome);
    });
  });
}

/**
 * Exclui a pessoa após confirmação do usuário
 */
async function confirmarEExcluir(id, nome) {
  const confirmou = confirm(
    `Tem certeza que deseja excluir o cadastro biométrico de "${nome}"?\n\n` +
    `Os embeddings de 1404 dimensões serão apagados permanentemente de data/pessoas.json.`
  );

  if (!confirmou) return;

  try {
    const res = await fetch(`/pessoas/${id}`, {
      method: 'DELETE'
    });

    const resultado = await res.json();

    if (!res.ok) {
      throw new Error(resultado.erro || 'Falha ao excluir pessoa.');
    }

    alert(`Pessoa "${nome}" foi excluída com sucesso.`);
    await carregarPessoas();
  } catch (erro) {
    console.error('[PESSOAS] Erro ao excluir:', erro);
    alert('Erro ao excluir: ' + erro.message);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.addEventListener('DOMContentLoaded', carregarPessoas);
