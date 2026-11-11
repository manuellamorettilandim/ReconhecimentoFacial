# 👁️ Face Access — Plataforma Didática de Reconhecimento Facial por Embeddings Geométricos

> **Projeto Didático para Aulas de Visão Computacional, Inteligência Artificial e Biometria**  
> Desenvolvido com MediaPipe Face Landmarker, Node.js puro, Álgebra Linear 3D manual e suporte opcional a MobileFaceNet ONNX.

---

## 📌 1. Visão Geral

O **Face Access** é uma plataforma educacional criada para demonstrar de forma **visível, interativa e explicável** como funciona o reconhecimento facial baseado em geometria tridimensional e *embeddings* numéricos.

Diferente de sistemas comerciais "caixa preta", o Face Access implementa **à mão** toda a matemática de alinhamento facial (Centróide, Normalização de Escala, Procrustes/Kabsch 3D e Distância Euclidiana), permitindo que estudantes e professores visualizem exatamente o que cada número representa.

### 🛡️ Princípio da Minimização de Dados e LGPD:
- **Nenhuma foto, imagem ou vídeo é transmitido ou salvo.**
- O frontend extrai apenas números (coordenadas tridimensionais dos pontos da face) e envia esses números via JSON para o backend.
- O backend armazena exclusivamente vetores matemáticos normalizados em `data/pessoas.json`.

---

## 🔬 2. Diagnóstico Didático: Por que 0.35 causava Falso Aceite?

### A Escala da Métrica "Média por Ponto" (RMSD 3D)
No Passo 2 da normalização geométrica, a nuvem de pontos é centralizada e dividida pelo fator de escala centróide $s$:
$$s = \sqrt{\frac{1}{N} \sum_{i=1}^N \|\vec{p}'_i\|^2}$$
Dessa forma, o crânio normalizado tem dispersão unitária ($\sum \|\vec{p}''_i\|^2 / N = 1$).

Como todas as faces humanas adultas compartilham proporções anatômicas similares (dois olhos superiores, nariz central e mandíbula inferior), quando duas pessoas diferentes são alinhadas por Procrustes contra o mesmo referencial:
- A distância espacial média entre o nariz de uma pessoa e o de outra gira em torno de **$0.060$ a $0.150$** unidades normalizadas.
- A distância entre o mesmo indivíduo em poses e expressões ligeiramente diferentes gira entre **$0.010$ e $0.040$** unidades (escala de **centésimos**).

### A Inadequação do Limiar Inicial (0.35):
Um limiar de **$0.35$** representava um desvio de $35\%$ do tamanho total do rosto para cada ponto! Com esse valor absurdo, praticamente qualquer pessoa não cadastrada (e até animais ou manequins) ficava muito abaixo de $0.35$, gerando **100% de falso aceite**.

### A Solução Adotada:
1. **Limiar Padrão Conservador:** Fixado inicialmente em **$0.050$** (escala de centésimos), rejeitando qualquer pessoa não cadastrada.
2. **Calibração Automática por Percentis:** Ajuste empírico na tela `/calibracao.html` baseado no ponto médio entre o $P_{95}$ das distâncias genuínas e o $P_5$ das distâncias impostoras.
3. **Margem de Separação de $1.3\times$:** Quando há duas ou mais pessoas cadastradas, a distância ao segundo candidato deve ser pelo menos $30\%$ maior que a do primeiro colocado.
4. **Decisão pela Média dos 10 Frames:** A aprovação só ocorre se a média móvel das distâncias dos 10 frames consecutivos ficar abaixo do limiar.

---

## 🏛️ 3. Estrutura dos 94 Pontos Estáveis (Imunidade a Expressões)

Para evitar que sorrisos, fala ou expressões faciais alterem o embedding e causem falsos aceites ou falsas rejeições, selecionamos **estritamente 94 marcos anatômicos ósseos e estruturais rígidos**:

### Lista Documentada de Índices (MediaPipe Face Mesh):
- **Nariz e Ponte Nasal (14 pontos):**  
  `[1, 2, 4, 5, 6, 19, 94, 98, 168, 195, 197, 236, 327, 456]`
- **Contorno Orbital do Olho Direito (16 pontos):**  
  `[7, 33, 133, 144, 145, 153, 154, 155, 157, 158, 159, 160, 161, 163, 173, 246]`
- **Contorno Orbital do Olho Esquerdo (16 pontos):**  
  `[249, 263, 362, 373, 374, 380, 381, 382, 384, 385, 386, 387, 388, 390, 398, 466]`
- **Oval Craniano, Mandíbula e Têmporas (36 pontos):**  
  `[10, 21, 54, 58, 67, 93, 103, 109, 127, 132, 136, 148, 149, 150, 152, 162, 172, 176, 234, 251, 284, 288, 297, 323, 332, 338, 356, 361, 365, 377, 378, 379, 389, 397, 400, 454]`
- **Região Malar / Zigomática (12 pontos):**  
  `[116, 123, 147, 192, 213, 214, 345, 352, 376, 416, 433, 434]`

### Exclusões Expressas:
- **Boca e Lábios (60+ pontos):** `0, 11-17, 37-42, 61, 76-88, 91, 95, 146, 178-185, 191, 267-272, 291, 306-324, 375, 402-415`
- **Sobrancelhas (20 pontos):** `46, 52-55, 63-70, 105, 107, 276, 282-285, 293-300, 334, 336`
- **Íris (10 pontos):** `468 a 477`

> 💡 **Comprovação em Teste:** O teste unitário `npm test` demonstra que um sorriso aberto altera os lábios mas produz **$0.000000$ de desvio** no embedding dos pontos estáveis.

---

## 📐 4. Modos de Embedding: Landmarks vs Modelo Neural (MobileFaceNet)

A plataforma permite chavear o modo de representação via variável de ambiente ou na interface:

```bash
# Modo didático clássico (padrão)
EMBEDDING_MODE="landmarks" npm start

# Modo com Rede Neural Convolucional Profunda
EMBEDDING_MODE="modelo" npm start
```

| Característica | Modo `landmarks` (Didático) | Modo `modelo` (Deep Learning) |
|---|---|---|
| **Tecnologia** | MediaPipe Face Mesh + Álgebra Linear 3D manual | MediaPipe (recorte) + MobileFaceNet ONNX via `onnxruntime-web` |
| **Pontos Utilizados** | 94 marcos ósseos estáveis | Bounding box alinhado pelos olhos ($112 \times 112$ pixels) |
| **Dimensão do Vetor** | 282 números reais ($94 \times 3$) | 512 números reais ($L_2$ normalizados) |
| **Versão do Modelo** | `mediapipe-pontos-estaveis-v2` | `mobilefacenet-v1` |
| **Métrica de Decisão** | Distância Euclidiana média por ponto ($RMSD < 0.05$) | Similaridade de Cosseno ($\cos \theta \ge 0.65 \implies d_{\cos} < 0.35$) |
| **Propósito Pedagógico** | Ensinar Álgebra Linear 3D (centróide, Procrustes, Kabsch) | Comparar com redes convolucionais profundas modernas |

---

## 🚀 5. Como Instalar e Rodar

### Pré-requisitos
- **Node.js** (versão 18 ou superior).
- Navegador moderno com suporte a WebGL e WebAssembly (Chrome, Edge ou Firefox).
- Webcam conectada.

### Execução

1. **Instale as dependências:**
   ```bash
   npm install
   ```

2. **Execute os testes automatizados:**
   ```bash
   npm test
   ```

3. **Inicie a aplicação:**
   ```bash
   npm start
   ```

4. **Abra no navegador:**
   [http://localhost:3000](http://localhost:3000)

> ⚠️ **Importante sobre a Câmera:** A API `getUserMedia` exige contexto seguro. No ambiente de desenvolvimento, utilize **`http://localhost:3000`** ou conexão HTTPS.

---

## 🎯 6. Calibração Automática de Limiar (`/calibracao.html`)

A tela de calibração permite definir o limiar ótimo através de estatística descritiva e minimização de taxas de erro:

1. **Amostras Genuínas ("Sou Eu"):** O usuário autorizado registra poses normais diante da câmera.
2. **Amostras Impostoras ("É Outro"):** Colegas ou pessoas não cadastradas registram amostras diante da câmera.
3. **Cálculo de Percentis:**
   - $P_{95}(\text{Genuínas})$: Valor abaixo do qual estão 95% das distâncias da pessoa autorizada.
   - $P_5(\text{Impostoras})$: Valor abaixo do qual estão apenas 5% das distâncias de invasores.
   - **Limiar Sugerido:**
     $$T = \frac{P_{95} + P_5}{2}$$
4. **Taxas de Erro em Tempo Real:**
   - **FAR (False Acceptance Rate):** $\frac{\text{Impostores com } d < T}{\text{Total Impostores}} \times 100\%$
   - **FRR (False Rejection Rate):** $\frac{\text{Genuínos com } d \ge T}{\text{Total Genuínos}} \times 100\%$
5. O botão **"Salvar Limiar em Config"** persiste o novo limiar em `data/config.json`.

---

## 🎓 7. Limitações para Discussão em Aula

1. **Escala Geométrica vs Semântica Neural:**
   - A geometria 3D direta compara coordenadas espaciais. Variações anatômicas sutis entre pessoas requerem limiares na casa dos centésimos ($0.04$ a $0.05$).
   - Já modelos como MobileFaceNet e ArcFace projetam faces em uma hiperesfera de 512 dimensões com perda angular (*Margin Loss*), maximizando a distância geodésica entre indivíduos.
2. **Segurança do Liveness por Piscada (EAR):**
   - O rastreamento de piscada por Eye Aspect Ratio protege contra fotos estáticas em papel, mas é vulnerável a vídeos pré-gravados em tablets ou injeção de vídeo sintético via browser.
3. **Trade-off de Segurança (FAR vs FRR):**
   - Reduzir o limiar para $0.035$ praticamente zera o falso aceite (FAR = 0%), mas pode aumentar a taxa de rejeição de usuários legítimos se a iluminação variar.
4. **Conformidade com a LGPD:**
   - O sistema segue o princípio da necessidade e minimização: apenas vetores numéricos são persistidos, e a rota `DELETE /pessoas/:id` garante o direito de eliminação dos dados.
