import React, { useState, useMemo, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  Upload,
  FileText,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Search,
  Download,
  Package,
  LayoutGrid,
  GitCompare,
  BarChart3,
  Settings,
  Loader2,
  X,
  ChevronRight,
  Armchair,
  Palette,
  Plus,
  Trash2,
  Pencil,
  Save,
  Users,
  RotateCcw,
} from "lucide-react";

// ============================================================
// TABELA DE CORES (persistência compartilhada)
// ============================================================

const COLOR_STORAGE_KEY = "sofashow:colorTable";

const DEFAULT_COLOR_TABLE = [
  { codigo: "33302", nome: "MARROM" },
  { codigo: "33300", nome: "CINZA" },
  { codigo: "33303", nome: "AZUL" },
  { codigo: "33305", nome: "CAPPUCCINO" },
  { codigo: "33316", nome: "VERDE" },
  { codigo: "33317", nome: "CINZA AZULADO" },
];

// Normaliza nome de cor pra comparação (remove acentos, espaços extras, prefixos de material)
// Lista de materiais que podem aparecer no nome do modelo ou da cor
// Removidos para não confundir o matching
const MATERIAIS = ["VELUDO", "LINHO", "VELVET", "SUEDE", "BOUCLE", "COURO", "CAMURÇA", "CAMURCA", "LINHÃO", "LINHAO"];

function normalizeColorName(name) {
  if (!name) return "";
  let s = name.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const mat of MATERIAIS) {
    s = s.replace(new RegExp(`\\b${mat}\\b`, "g"), "");
  }
  return s
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Remove acentos para comparação de modelo
function removeAcentos(s) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Limpa o nome do modelo: remove materiais, "+ PUFF", parênteses, etc.
function limparModelo(modelo) {
  if (!modelo) return "";
  let s = modelo.toUpperCase().trim();
  // Remove "+ PUFF" e variações
  s = s.replace(/\s*\+\s*PUFF\b/gi, "");
  // Remove conteúdo entre parênteses: "(2L SEM BRAÇO)"
  s = s.replace(/\([^)]*\)/g, "");
  // Remove materiais
  for (const mat of MATERIAIS) {
    s = s.replace(new RegExp(`\\b${mat}\\b`, "gi"), "");
  }
  // Remove números soltos no final (códigos de cor que escaparam)
  s = s.replace(/\s+\d+\s*$/, "");
  return s.replace(/\s+/g, " ").trim();
}

// Se a medida estiver vazia mas o modelo tiver medida embutida, extrai
function extrairMedidaDoModelo(modelo, medidaAtual) {
  if (medidaAtual && medidaAtual.trim()) return { modelo, medida: medidaAtual };
  if (!modelo) return { modelo, medida: medidaAtual };
  // Procura medida composta: "1,80X3,50", "2.15 X 1.95"
  const mMult = modelo.match(/(\d+[,.]?\d*\s*[Xx]\s*\d+[,.]?\d*)/);
  if (mMult) {
    const novoModelo = (modelo.substring(0, mMult.index) + modelo.substring(mMult.index + mMult[0].length)).trim();
    return { modelo: novoModelo, medida: mMult[1] };
  }
  // Procura medida simples: "1,30", "2,90"
  const mSing = modelo.match(/(?<!\d)(\d+[,.]\d+)(?!\d)/);
  if (mSing) {
    const novoModelo = (modelo.substring(0, mSing.index) + modelo.substring(mSing.index + mSing[0].length)).trim();
    return { modelo: novoModelo, medida: mSing[1] };
  }
  return { modelo, medida: medidaAtual };
}

// ============================================================
// PARSERS
// ============================================================

// Extrai produtos do relatório de estoque negativo do SIFAT (PDF ou planilha convertidos em texto)
// Formato típico: "9213 ESTOF CANTO CUBA 2,50X2,50 COR 33302 MARROM // 1 -1 -1 UN ..."
function parseSifatText(rawText) {
  const items = [];
  const lines = rawText.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const codeMatch = trimmed.match(/^(\d{3,6})\s+(.+)/);
    if (!codeMatch) continue;

    const codigo = codeMatch[1];
    let resto = codeMatch[2];

    if (/total|folha|código|descri|fl -|produto fora/i.test(resto)) continue;

    // Quantidade disponível — padrão "// 1 -2 -2 UN" (o segundo número negativo é a qtde em falta)
    const qtyMatch = resto.match(/\/\/\s*\S*\s*(-?\d+)\s+(-?\d+)\s+UN/i);
    const qtdeDisponivel = qtyMatch ? parseInt(qtyMatch[2], 10) : null;

    if (qtdeDisponivel === null || qtdeDisponivel >= 0) continue;

    const descMatch = resto.match(/^(.+?)\/\//);
    const descricao = descMatch ? descMatch[1].trim() : resto.trim();

    const parsed = parseDescricao(descricao);

    items.push({
      codigo,
      descricao,
      quantidadeNegativa: Math.abs(qtdeDisponivel),
      ...parsed,
    });
  }

  return items;
}

// "ESTOF CUBA 2,50 COR 33302 MARROM" → { modelo:"CUBA", medida:"2.50", corCodigo:"33302", corNome:"MARROM" }
// Também lida com "ESTOF TIGUAN 3,50 C/2 MOD 1,00 E C/1 CHAISE" (não tem "COR ...")
function parseDescricao(desc) {
  if (!desc) return { modelo: "", medida: "", corCodigo: "", corNome: "" };

  let s = desc.toUpperCase().trim();
  s = s.replace(/^ESTOF(?:ADO)?\s+/i, "");

  // Se tem "C/n MOD...", corta tudo a partir daí ANTES de procurar medida/cor
  // (isso evita pegar "1,00" como medida em "TIGUAN 3,50 C/2 MOD 1,00 E C/1 CHAISE")
  s = s.replace(/\s+C\s*\/\s*\d+.*$/i, "").trim();

  let corCodigo = "";
  let corNome = "";
  const corMatch = s.match(/\bCOR\s+(.+)$/i);
  if (corMatch) {
    const corTxt = corMatch[1].trim();
    const codMatch = corTxt.match(/^([\w-]+)/);
    // Só considera código se tiver pelo menos um dígito (ex: "33302", "3040-02", "C-426")
    // "MARROM" sozinho NÃO é código.
    if (codMatch && /\d/.test(codMatch[1])) {
      corCodigo = codMatch[1].replace(/^-/, "");
      corNome = corTxt.substring(codMatch[0].length).trim();
    } else {
      corNome = corTxt;
    }
    s = s.substring(0, corMatch.index).trim();
  }

  let medida = "";
  // Tenta medida composta primeiro: "2,50X2,50", "1,80X2,70"
  const medMatchMult = s.match(/(\d+[,.]?\d*\s*[Xx]\s*\d+[,.]?\d*)/);
  if (medMatchMult) {
    medida = normalizeMedida(medMatchMult[1]);
    s = s.replace(medMatchMult[1], "").trim();
  } else {
    // Medida simples: "2,50", "1,90", "2 L", "3 L"
    const medMatchSingle = s.match(/(\d+[,.]\d+|\d+\s*L\b)/);
    if (medMatchSingle) {
      medida = normalizeMedida(medMatchSingle[1]);
      s = s.replace(medMatchSingle[1], "").trim();
    }
  }

  s = s.replace(/\s+/g, " ").trim();
  s = limparModelo(s); // remove materiais, "+ PUFF", parênteses

  return { modelo: s, medida, corCodigo: corCodigo.toUpperCase(), corNome };
}

function parsePedidoRow(row) {
  let modeloRaw = String(row["MODELO"] || "").toUpperCase().trim();
  let medidaRaw = String(row["MEDIDA"] || "").trim();
  const corRaw = String(row["COR"] || "").toUpperCase().trim();
  const quant = Number(row["QUANT"] || 0);

  // BUG 1: Se a medida estiver vazia mas o modelo tiver medida embutida, extrair
  const extraido = extrairMedidaDoModelo(modeloRaw, medidaRaw);
  modeloRaw = extraido.modelo;
  medidaRaw = extraido.medida;

  const medida = normalizeMedida(medidaRaw);
  const modelo = limparModelo(modeloRaw); // BUGS 3, 4: remove materiais, "+ PUFF"

  // BUG 2: Cor pode vir com prefixo material, ex: "LINHO 02 BEGE" → código "02"
  let corSemMaterial = corRaw;
  for (const mat of MATERIAIS) {
    corSemMaterial = corSemMaterial.replace(new RegExp(`\\b${mat}\\b`, "g"), "").trim();
  }
  corSemMaterial = corSemMaterial.replace(/\s+/g, " ").trim();

  let corCodigo = "";
  let corNome = corRaw;
  const codMatch = corSemMaterial.match(/^([\w-]+)(?:\s*-\s*|\s+)?(.*)$/);
  if (codMatch) {
    const possibleCode = codMatch[1];
    if (/\d/.test(possibleCode)) {
      corCodigo = possibleCode;
      corNome = (codMatch[2] || "").replace(/^-\s*/, "").trim();
    }
  }

  return {
    modelo,
    medida,
    corCodigo: corCodigo.toUpperCase(),
    corNome,
    quantidade: quant,
    fornecedor: String(row["FORNECEDOR"] || "").trim(),
    cliente: String(row["CLIENTE"] || "").trim(),
    numeroPedido: String(row["NUMERO PEDIDO"] || "").trim(),
    data: String(row["DATA"] || "").trim(),
    obs: String(row["OBS"] || "").trim(),
    raw: row,
  };
}

// Normaliza medida para comparação:
//   "2,50" → "2.50"      "2.5" → "2.50"       "2 L" → "2L"
//   "2,50X2,50" → "2.50X2.50"     "2.5 x 2.5" → "2.50X2.50"
function normalizeMedida(m) {
  if (!m) return "";
  let s = m.replace(/,/g, ".").toUpperCase().replace(/\s+/g, "");
  // Medida composta (AxB): normaliza cada lado separadamente
  const multMatch = s.match(/^(\d+\.?\d*)X(\d+\.?\d*)$/);
  if (multMatch) {
    const a = padMedida(multMatch[1]);
    const b = padMedida(multMatch[2]);
    return `${a}X${b}`;
  }
  return padMedida(s);
}

// "2" → "2", "2.5" → "2.50", "2.50" → "2.50", "2L" → "2L"
function padMedida(s) {
  if (/^\d+\.\d$/.test(s)) return s + "0"; // "2.5" → "2.50"
  return s;
}

function itemsMatch(sifatItem, pedidoItem, colorTable = []) {
  // Resolve código da cor usando a tabela de sinônimos se necessário
  const sifatCor = resolveColorCode(sifatItem, colorTable);
  const pedidoCor = resolveColorCode(pedidoItem, colorTable);

  // Se SIFAT não tem cor identificável, casa por modelo+medida apenas
  // (caso típico: TIGUAN vem sem campo "COR" na descrição)
  const sifatSemCor = !sifatCor;

  if (!sifatSemCor) {
    if (!pedidoCor) return false;
    if (sifatCor !== pedidoCor) return false;
  }

  // BUG 6: Match flexível de modelo por palavras-chave
  // Ex: "POLTRONA CONFORTO" (SIFAT) deve casar com "POLTRONA CONFORTO + PUFF" (pedido)
  // Ex: "PUFF MUNIQUE" deve casar com "PUFF CANTO MUNIQUE"
  const sModeloNorm = removeAcentos(sifatItem.modelo).trim();
  const pModeloNorm = removeAcentos(pedidoItem.modelo).trim();

  if (!sModeloNorm || !pModeloNorm) return false;

  const GENERICAS = new Set(["DE", "DA", "DO", "E", "+"]);
  const sPalavras = new Set(
    sModeloNorm.split(/\s+/).filter((w) => w && !GENERICAS.has(w) && w.length >= 2)
  );
  const pPalavras = new Set(
    pModeloNorm.split(/\s+/).filter((w) => w && !GENERICAS.has(w) && w.length >= 2)
  );

  if (sPalavras.size === 0 || pPalavras.size === 0) return false;

  // SIFAT está contido no pedido OU pedido contido no SIFAT
  const sIncluidoEmP = [...sPalavras].every((w) => pPalavras.has(w));
  const pIncluidoEmS = [...pPalavras].every((w) => sPalavras.has(w));
  if (!sIncluidoEmP && !pIncluidoEmS) return false;

  const sMed = normalizeMedida(sifatItem.medida);
  const pMed = normalizeMedida(pedidoItem.medida);

  // BUG 7: SIFAT sem medida casa com pedido de qualquer medida
  // (ex: "ESTOF CANTO MUNIQUE + PUFF" sem medida casa com "CANTO MUNIQUE + PUFF 2,15X1,95")
  if (!sMed) return true;
  // Se SIFAT tem medida mas pedido não tem, não casa (medida é obrigatória)
  if (!pMed) return false;

  // IMPORTANTE: medida com "X" (canto) é PRODUTO DIFERENTE de medida sem "X" (sofá reto)
  const sTemX = sMed.includes("X");
  const pTemX = pMed.includes("X");
  if (sTemX !== pTemX) return false;

  if (sMed === pMed) return true;

  // Só compara numericamente quando NENHUM dos dois tem X
  if (!sTemX && !pTemX) {
    const sNum = parseFloat(sMed);
    const pNum = parseFloat(pMed);
    if (!isNaN(sNum) && !isNaN(pNum) && Math.abs(sNum - pNum) < 0.01) return true;
  }

  return false;
}

// Retorna o código normalizado da cor. Se o item só tem nome, tenta resolver via tabela.
function resolveColorCode(item, colorTable) {
  const cod = (item.corCodigo || "").replace(/^0+/, "").toUpperCase();
  if (cod) return cod;

  // Sem código explícito → tenta extrair um código numérico de dentro do nome
  // Ex: "MARROM TOSTADO 100828" → código "100828"
  //     "MARROM 11" → código "11"
  //     "LINHO 78 CHAMPAGNE" → "78" (após remover material)
  let nome = (item.corNome || "").toUpperCase().trim();
  // Remove materiais antes de procurar código embarcado
  for (const mat of MATERIAIS) {
    nome = nome.replace(new RegExp(`\\b${mat}\\b`, "g"), "").trim();
  }
  nome = nome.replace(/\s+/g, " ").trim();

  const embeddedCode = nome.match(/\b(\d{2,}|\d+-\d+|[A-Z]?-?\d+)\b/);
  if (embeddedCode) {
    return embeddedCode[1].replace(/^0+/, "").toUpperCase();
  }

  // Sem código nenhum → tenta bater pelo nome usando a tabela (match exato normalizado)
  const nomeNorm = normalizeColorName(nome);
  if (!nomeNorm) return "";

  for (const entry of colorTable) {
    const entryNome = normalizeColorName(entry.nome);
    if (!entryNome) continue;
    // Match exato apenas (evita falso positivo com "MARROM" casando "MARROM TOSTADO")
    if (entryNome === nomeNorm) {
      return entry.codigo.replace(/^0+/, "").toUpperCase();
    }
  }

  return "";
}

// ============================================================
// LEITORES DE ARQUIVO
// ============================================================

async function readPedidosFile(file) {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  return rows
    .filter((r) => r["MODELO"] && r["QUANT"])
    .map(parsePedidoRow);
}

async function readSifatFile(file) {
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf")) {
    return await readSifatPdf(file);
  }

  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const csv = XLSX.utils.sheet_to_csv(sheet, { FS: " ", RS: "\n" });
    return parseSifatText(csv);
  }

  const text = await file.text();
  return parseSifatText(text);
}

async function readSifatPdf(file) {
  if (!window.pdfjsLib) {
    await loadPdfJs();
  }
  const data = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data }).promise;
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const lines = {};
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      if (!lines[y]) lines[y] = [];
      lines[y].push({ x: item.transform[4], str: item.str });
    }
    const sortedY = Object.keys(lines).sort((a, b) => b - a);
    for (const y of sortedY) {
      lines[y].sort((a, b) => a.x - b.x);
      fullText += lines[y].map((i) => i.str).join(" ") + "\n";
    }
  }
  return parseSifatText(fullText);
}

function loadPdfJs() {
  return new Promise((resolve, reject) => {
    if (window.pdfjsLib) return resolve();
    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// ============================================================
// CONCILIAÇÃO
// ============================================================

function conciliar(sifatItems, pedidoItems, colorTable = []) {
  const esquecidos = [];
  const cobertos = [];
  const pedidosUsados = new Set(); // rastreia quais pedidos casaram com algum negativo

  for (const s of sifatItems) {
    const matches = pedidoItems.filter((p) => itemsMatch(s, p, colorTable));
    const qtdPedida = matches.reduce((sum, p) => sum + (p.quantidade || 0), 0);

    // Marca os pedidos que casaram com esse negativo
    matches.forEach((p) => pedidosUsados.add(p));

    if (qtdPedida >= s.quantidadeNegativa) {
      cobertos.push({ sifat: s, pedidos: matches, qtdPedida });
    } else {
      esquecidos.push({
        sifat: s,
        pedidos: matches,
        qtdPedida,
        faltam: s.quantidadeNegativa - qtdPedida,
      });
    }
  }

  // Pedidos que NÃO casaram com nenhum negativo do SIFAT
  // (loja fez encomenda mas o produto não está negativo no estoque)
  const semNegativo = pedidoItems.filter((p) => !pedidosUsados.has(p));

  return { esquecidos, cobertos, semNegativo };
}

// ============================================================
// HOOK: Tabela de Cores (persistência compartilhada)
// ============================================================

// Detecta se window.storage existe (ambiente Claude). Caso contrário, usa localStorage.
const hasClaudeStorage = typeof window !== "undefined" && window.storage && typeof window.storage.get === "function";

async function storageGet(key) {
  if (hasClaudeStorage) {
    const result = await window.storage.get(key, true);
    return result && result.value ? result.value : null;
  }
  // Fallback: localStorage
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage.getItem(key);
  }
  return null;
}

async function storageSet(key, value) {
  if (hasClaudeStorage) {
    await window.storage.set(key, value, true);
    return;
  }
  // Fallback: localStorage
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.setItem(key, value);
    return;
  }
  throw new Error("Nenhum sistema de armazenamento disponível");
}

function useColorTable() {
  const [table, setTable] = useState([]);
  const [loaded, setLoaded] = useState(false);

  // Carrega ao montar
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const value = await storageGet(COLOR_STORAGE_KEY);
        if (cancelled) return;
        if (value) {
          const parsed = JSON.parse(value);
          setTable(Array.isArray(parsed) ? parsed : DEFAULT_COLOR_TABLE);
        } else {
          setTable(DEFAULT_COLOR_TABLE);
          // Salva os padrões na primeira vez
          try {
            await storageSet(COLOR_STORAGE_KEY, JSON.stringify(DEFAULT_COLOR_TABLE));
          } catch {}
        }
      } catch (e) {
        if (!cancelled) {
          setTable(DEFAULT_COLOR_TABLE);
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (newTable) => {
    setTable(newTable);
    try {
      await storageSet(COLOR_STORAGE_KEY, JSON.stringify(newTable));
      return true;
    } catch (e) {
      console.error("Erro ao salvar tabela de cores", e);
      return false;
    }
  }, []);

  return { table, save, loaded };
}

// ============================================================
// UI COMPONENTS
// ============================================================

function FileDropZone({ label, sublabel, icon: Icon, accept, file, onFile, onClear, disabled }) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`relative border-2 border-dashed rounded-lg p-6 transition-all ${
        dragging
          ? "border-amber-700 bg-amber-50"
          : file
          ? "border-emerald-600 bg-emerald-50/40"
          : "border-stone-300 bg-stone-50/50 hover:border-stone-400"
      }`}
    >
      {file ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-700" />
            </div>
            <div>
              <p className="font-serif text-sm font-semibold text-stone-900">{label}</p>
              <p className="text-xs text-stone-600 truncate max-w-xs">{file.name}</p>
            </div>
          </div>
          <button
            onClick={onClear}
            className="p-1.5 rounded-md hover:bg-stone-200 transition-colors"
            aria-label="Remover"
          >
            <X className="w-4 h-4 text-stone-600" />
          </button>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center cursor-pointer text-center">
          <Icon className="w-8 h-8 text-stone-400 mb-2" />
          <p className="font-serif text-sm font-semibold text-stone-800">{label}</p>
          <p className="text-xs text-stone-500 mt-1">{sublabel}</p>
          <p className="text-xs text-amber-800 mt-2 font-medium">Clique ou arraste aqui</p>
          <input
            type="file"
            accept={accept}
            className="hidden"
            disabled={disabled}
            onChange={(e) => {
              const f = e.target.files[0];
              if (f) onFile(f);
            }}
          />
        </label>
      )}
    </div>
  );
}

function StatCard({ label, value, sublabel, accent, icon: Icon }) {
  const accentColors = {
    red: "border-red-200 bg-red-50/60",
    green: "border-emerald-200 bg-emerald-50/60",
    amber: "border-amber-200 bg-amber-50/60",
    stone: "border-stone-200 bg-white",
  };
  const textColors = {
    red: "text-red-900",
    green: "text-emerald-800",
    amber: "text-amber-900",
    stone: "text-stone-900",
  };
  return (
    <div className={`border rounded-lg p-4 ${accentColors[accent]}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs uppercase tracking-wider font-semibold text-stone-600">{label}</p>
        {Icon && <Icon className={`w-4 h-4 ${textColors[accent]}`} />}
      </div>
      <p className={`font-serif text-3xl font-bold ${textColors[accent]}`}>{value}</p>
      {sublabel && <p className="text-xs text-stone-600 mt-1">{sublabel}</p>}
    </div>
  );
}

function ConciliacaoModule({ colorTable }) {
  const [pedidosFile, setPedidosFile] = useState(null);
  const [sifatFile, setSifatFile] = useState(null);
  const [pedidos, setPedidos] = useState([]);
  const [sifat, setSifat] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeView, setActiveView] = useState("esquecidos");

  const handlePedidos = async (f) => {
    setError("");
    setLoading(true);
    setPedidosFile(f);
    try {
      const items = await readPedidosFile(f);
      setPedidos(items);
    } catch (e) {
      setError("Erro ao ler planilha de pedidos: " + e.message);
      setPedidosFile(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSifat = async (f) => {
    setError("");
    setLoading(true);
    setSifatFile(f);
    try {
      const items = await readSifatFile(f);
      setSifat(items);
    } catch (e) {
      setError("Erro ao ler relatório do SIFAT: " + e.message);
      setSifatFile(null);
    } finally {
      setLoading(false);
    }
  };

  const result = useMemo(() => {
    if (!pedidos.length || !sifat.length) return null;
    return conciliar(sifat, pedidos, colorTable);
  }, [pedidos, sifat, colorTable]);

  const filteredEsquecidos = useMemo(() => {
    if (!result) return [];
    const t = searchTerm.toLowerCase();
    if (!t) return result.esquecidos;
    return result.esquecidos.filter(
      (e) =>
        e.sifat.descricao.toLowerCase().includes(t) ||
        e.sifat.codigo.includes(t) ||
        e.sifat.modelo.toLowerCase().includes(t)
    );
  }, [result, searchTerm]);

  const filteredCobertos = useMemo(() => {
    if (!result) return [];
    const t = searchTerm.toLowerCase();
    if (!t) return result.cobertos;
    return result.cobertos.filter(
      (e) =>
        e.sifat.descricao.toLowerCase().includes(t) ||
        e.sifat.codigo.includes(t) ||
        e.sifat.modelo.toLowerCase().includes(t)
    );
  }, [result, searchTerm]);

  const filteredSemNegativo = useMemo(() => {
    if (!result) return [];
    const t = searchTerm.toLowerCase();
    if (!t) return result.semNegativo;
    return result.semNegativo.filter(
      (p) =>
        p.modelo.toLowerCase().includes(t) ||
        p.cliente.toLowerCase().includes(t) ||
        p.numeroPedido.toLowerCase().includes(t) ||
        p.corNome.toLowerCase().includes(t)
    );
  }, [result, searchTerm]);

  const exportarAtual = () => {
    if (!result) return;

    // Data de hoje pro nome do arquivo (formato YYYY-MM-DD)
    const hoje = new Date().toISOString().slice(0, 10);

    let rows = [];
    let sheetName = "";
    let fileName = "";

    if (activeView === "esquecidos") {
      rows = result.esquecidos.map((e) => ({
        "Código SIFAT": e.sifat.codigo,
        Descrição: e.sifat.descricao,
        Modelo: e.sifat.modelo,
        Medida: e.sifat.medida,
        "Código Cor": e.sifat.corCodigo,
        "Nome Cor": e.sifat.corNome,
        "Qtde Negativa": e.sifat.quantidadeNegativa,
        "Qtde Pedida": e.qtdPedida,
        "Qtde Faltando": e.faltam,
      }));
      sheetName = "Encomendas Nao Realizadas";
      fileName = `encomendas-nao-realizadas_${hoje}.xlsx`;
    } else if (activeView === "cobertos") {
      // Conciliados — uma linha por PEDIDO vinculado (pra ficar mais útil)
      rows = result.cobertos.flatMap((e) =>
        e.pedidos.map((p) => ({
          "Código SIFAT": e.sifat.codigo,
          "Produto": e.sifat.descricao,
          "Modelo": e.sifat.modelo,
          "Medida": e.sifat.medida,
          "Código Cor": e.sifat.corCodigo,
          "Nome Cor": e.sifat.corNome,
          "Qtde Negativa": e.sifat.quantidadeNegativa,
          "Nº Pedido": p.numeroPedido,
          "Cliente": p.cliente,
          "Fornecedor": p.fornecedor,
          "Data": p.data,
          "Qtde Pedida": p.quantidade,
          "Obs": p.obs,
        }))
      );
      sheetName = "Conciliados";
      fileName = `conciliados_${hoje}.xlsx`;
    } else if (activeView === "semNegativo") {
      rows = result.semNegativo.map((p) => ({
        "Nº Pedido": p.numeroPedido,
        "Cliente": p.cliente,
        "Modelo": p.modelo,
        "Medida": p.medida,
        "Código Cor": p.corCodigo,
        "Nome Cor": p.corNome,
        "Fornecedor": p.fornecedor,
        "Data": p.data,
        "Qtde Pedida": p.quantidade,
        "Obs": p.obs,
      }));
      sheetName = "Divergencias";
      fileName = `divergencias_${hoje}.xlsx`;
    }

    if (rows.length === 0) return;

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, fileName);
  };

  const reset = () => {
    setPedidosFile(null);
    setSifatFile(null);
    setPedidos([]);
    setSifat([]);
    setError("");
    setSearchTerm("");
  };

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header do módulo */}
      <div className="mb-8 border-b border-stone-200 pb-6">
        <div className="flex items-baseline gap-3 mb-2">
          <span className="text-xs uppercase tracking-[0.2em] text-amber-800 font-semibold">
            Módulo 01
          </span>
          <span className="text-stone-300">—</span>
          <span className="text-xs uppercase tracking-wider text-stone-500">
            Estoque & Encomendas
          </span>
        </div>
        <h1 className="font-serif text-4xl font-bold text-stone-900 tracking-tight">
          Conciliação dos Pedidos com os Negativos do Sistema
        </h1>
        <p className="text-stone-600 mt-2 max-w-2xl">
          Cruza o relatório de estoque negativo do <strong>SIFAT</strong> com a planilha de
          pedidos da loja para identificar itens que ficaram sem encomenda.
        </p>
      </div>

      {/* Upload */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <FileDropZone
          label="Produtos Encomendados"
          sublabel="Planilha .xlsx exportada do sistema de pedidos"
          icon={FileSpreadsheet}
          accept=".xlsx,.xls,.csv"
          file={pedidosFile}
          onFile={handlePedidos}
          onClear={() => {
            setPedidosFile(null);
            setPedidos([]);
          }}
          disabled={loading}
        />
        <FileDropZone
          label="Estoque Negativo (SIFAT)"
          sublabel="PDF, Excel ou CSV"
          icon={FileText}
          accept=".pdf,.xlsx,.xls,.csv"
          file={sifatFile}
          onFile={handleSifat}
          onClear={() => {
            setSifatFile(null);
            setSifat([]);
          }}
          disabled={loading}
        />
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-stone-600 text-sm mb-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Processando arquivo…
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-900 rounded-lg p-4 mb-4">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Resultado */}
      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard
              label="Encomendas Não Realizadas"
              value={result.esquecidos.length}
              sublabel="negativo sem pedido"
              accent="red"
              icon={XCircle}
            />
            <StatCard
              label="Divergências"
              value={result.semNegativo.length}
              sublabel="pedido sem negativo"
              accent="amber"
              icon={AlertTriangle}
            />
            <StatCard
              label="Conciliados"
              value={result.cobertos.length}
              sublabel="tudo certo"
              accent="green"
              icon={CheckCircle2}
            />
            <StatCard
              label="Total processado"
              value={`${sifat.length} / ${pedidos.length}`}
              sublabel="negativos / pedidos"
              accent="stone"
              icon={Package}
            />
          </div>

          {/* Barra de ações */}
          <div className="flex flex-wrap items-center gap-3 mb-4 pb-4 border-b border-stone-200">
            <div className="flex bg-stone-100 rounded-md p-1 flex-wrap">
              <button
                onClick={() => setActiveView("esquecidos")}
                className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
                  activeView === "esquecidos"
                    ? "bg-white text-red-900 shadow-sm"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                Encomendas Não Realizadas ({result.esquecidos.length})
              </button>
              <button
                onClick={() => setActiveView("semNegativo")}
                className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
                  activeView === "semNegativo"
                    ? "bg-white text-amber-900 shadow-sm"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                Divergências ({result.semNegativo.length})
              </button>
              <button
                onClick={() => setActiveView("cobertos")}
                className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
                  activeView === "cobertos"
                    ? "bg-white text-emerald-800 shadow-sm"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                Conciliados ({result.cobertos.length})
              </button>
            </div>

            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input
                type="text"
                placeholder="Buscar por código, modelo ou descrição…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-amber-700/30 focus:border-amber-700"
              />
            </div>

            <div className="flex gap-2 ml-auto">
              <button
                onClick={exportarAtual}
                disabled={
                  (activeView === "esquecidos" && !result.esquecidos.length) ||
                  (activeView === "cobertos" && !result.cobertos.length) ||
                  (activeView === "semNegativo" && !result.semNegativo.length)
                }
                className="flex items-center gap-2 px-3 py-2 text-sm border border-stone-300 rounded-md bg-white hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Baixar a aba atual em Excel"
              >
                <Download className="w-4 h-4" />
                Baixar Excel
              </button>
              <button
                onClick={reset}
                className="px-3 py-2 text-sm text-stone-600 hover:text-stone-900"
              >
                Reiniciar
              </button>
            </div>
          </div>

          {/* Lista */}
          {activeView === "esquecidos" && <EsquecidosList items={filteredEsquecidos} />}
          {activeView === "semNegativo" && <SemNegativoList items={filteredSemNegativo} />}
          {activeView === "cobertos" && <CobertosList items={filteredCobertos} />}
        </>
      )}

      {!result && !loading && (pedidosFile || sifatFile) && (
        <div className="text-center py-12 text-stone-500 text-sm">
          Envie os dois arquivos para iniciar a conciliação.
        </div>
      )}

      {!pedidosFile && !sifatFile && !loading && (
        <div className="text-center py-16 bg-gradient-to-b from-amber-50/40 to-transparent rounded-lg border border-stone-200">
          <GitCompare className="w-10 h-10 text-amber-800 mx-auto mb-3" />
          <p className="font-serif text-lg text-stone-800 mb-1">
            Pronto para conciliar
          </p>
          <p className="text-sm text-stone-600 max-w-md mx-auto">
            Envie a planilha de pedidos da loja e o relatório de estoque negativo do SIFAT para
            identificar itens que ficaram sem encomenda.
          </p>
        </div>
      )}
    </div>
  );
}

function EsquecidosList({ items }) {
  if (!items.length) {
    return (
      <div className="text-center py-12">
        <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
        <p className="font-serif text-lg text-stone-800">Nenhuma encomenda não realizada</p>
        <p className="text-sm text-stone-600 mt-1">
          Todos os negativos do SIFAT têm pedido correspondente.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((e, i) => (
        <div
          key={i}
          className="border border-red-200 bg-white rounded-lg overflow-hidden"
        >
          <div className="flex items-start p-4 gap-4">
            <div className="w-10 h-10 rounded-md bg-red-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-xs font-mono text-stone-500">
                  #{e.sifat.codigo}
                </span>
                <h3 className="font-serif font-semibold text-stone-900 truncate">
                  {e.sifat.descricao}
                </h3>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
                <span>
                  Modelo: <strong className="text-stone-900">{e.sifat.modelo}</strong>
                </span>
                {e.sifat.medida && (
                  <span>
                    Medida: <strong className="text-stone-900">{e.sifat.medida}</strong>
                  </span>
                )}
                <span>
                  Cor:{" "}
                  <strong className="text-stone-900">
                    {e.sifat.corCodigo} {e.sifat.corNome}
                  </strong>
                </span>
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-xs text-stone-500 uppercase tracking-wider">Negativo</p>
                  <p className="font-serif text-xl font-bold text-stone-900">
                    {e.sifat.quantidadeNegativa}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-stone-500 uppercase tracking-wider">Pedido</p>
                  <p className="font-serif text-xl font-bold text-stone-500">
                    {e.qtdPedida}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-red-700 uppercase tracking-wider font-semibold">
                    Faltam
                  </p>
                  <p className="font-serif text-2xl font-bold text-red-700">
                    {e.faltam}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CobertosList({ items }) {
  const [expanded, setExpanded] = useState(null);

  if (!items.length) {
    return (
      <div className="text-center py-12 text-stone-500 text-sm">
        Nenhum item conciliado ainda.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((e, i) => (
        <div
          key={i}
          className="border border-emerald-200 bg-white rounded-lg overflow-hidden"
        >
          <button
            onClick={() => setExpanded(expanded === i ? null : i)}
            className="w-full flex items-start p-4 gap-4 text-left hover:bg-emerald-50/30 transition-colors"
          >
            <div className="w-10 h-10 rounded-md bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-xs font-mono text-stone-500">
                  #{e.sifat.codigo}
                </span>
                <h3 className="font-serif font-semibold text-stone-900 truncate">
                  {e.sifat.descricao}
                </h3>
              </div>
              <div className="flex flex-wrap gap-x-4 text-xs text-stone-600">
                <span>
                  Cor:{" "}
                  <strong className="text-stone-900">
                    {e.sifat.corCodigo} {e.sifat.corNome}
                  </strong>
                </span>
                <span>
                  Pedidos vinculados:{" "}
                  <strong className="text-emerald-800">{e.pedidos.length}</strong>
                </span>
              </div>
            </div>
            <div className="flex items-center gap-4 flex-shrink-0">
              <div className="text-right">
                <p className="text-xs text-emerald-700 uppercase tracking-wider font-semibold">
                  Quantidade
                </p>
                <p className="font-serif text-xl font-bold text-emerald-800">
                  {e.qtdPedida}/{e.sifat.quantidadeNegativa}
                </p>
              </div>
              <ChevronRight
                className={`w-4 h-4 text-stone-400 transition-transform ${
                  expanded === i ? "rotate-90" : ""
                }`}
              />
            </div>
          </button>
          {expanded === i && (
            <div className="border-t border-emerald-100 bg-emerald-50/30 p-4">
              <p className="text-xs uppercase tracking-wider font-semibold text-stone-600 mb-2">
                Pedidos vinculados
              </p>
              <div className="space-y-2">
                {e.pedidos.map((p, j) => (
                  <div
                    key={j}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm bg-white border border-stone-200 rounded p-2"
                  >
                    <span className="font-mono text-xs text-stone-500">
                      {p.numeroPedido}
                    </span>
                    <span className="font-medium text-stone-900">{p.cliente}</span>
                    <span className="text-stone-600">{p.fornecedor}</span>
                    <span className="text-stone-500 text-xs">{p.data}</span>
                    <span className="ml-auto font-serif font-bold text-stone-900">
                      {p.quantidade}×
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SemNegativoList({ items }) {
  if (!items.length) {
    return (
      <div className="text-center py-12">
        <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
        <p className="font-serif text-lg text-stone-800">Nenhuma divergência</p>
        <p className="text-sm text-stone-600 mt-1">
          Todos os pedidos têm produto correspondente em negativo no SIFAT.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-800 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-amber-900">
          <p className="mb-2">
            <strong>Pedidos lançados mas o produto NÃO está negativo no SIFAT.</strong>
          </p>
          <p className="mb-1 font-semibold">Possíveis causas:</p>
          <ul className="list-disc list-inside space-y-0.5 pl-1">
            <li>Pode se tratar de uma troca</li>
            <li>O produto já estava em estoque e, mesmo assim, foi feita a encomenda</li>
            <li>O pedido não foi finalizado corretamente</li>
            <li>Divergência de estoque (estoque não confere com o sistema)</li>
          </ul>
        </div>
      </div>

      {items.map((p, i) => (
        <div
          key={i}
          className="border border-amber-200 bg-white rounded-lg overflow-hidden"
        >
          <div className="flex items-start p-4 gap-4">
            <div className="w-10 h-10 rounded-md bg-amber-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-xs font-mono text-stone-500">
                  {p.numeroPedido}
                </span>
                <h3 className="font-serif font-semibold text-stone-900 truncate">
                  {p.modelo}
                  {p.medida && ` — ${p.medida}`}
                </h3>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
                <span>
                  Cliente: <strong className="text-stone-900">{p.cliente}</strong>
                </span>
                <span>
                  Cor:{" "}
                  <strong className="text-stone-900">
                    {p.corCodigo} {p.corNome}
                  </strong>
                </span>
                <span>
                  Fornecedor: <strong className="text-stone-900">{p.fornecedor}</strong>
                </span>
                <span>Data: <strong className="text-stone-900">{p.data}</strong></span>
                {p.obs && (
                  <span className="text-amber-800">
                    Obs: <strong>{p.obs}</strong>
                  </span>
                )}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-stone-500 uppercase tracking-wider">Quantidade</p>
              <p className="font-serif text-2xl font-bold text-amber-700">
                {p.quantidade}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ColorTableModule({ table, onSave }) {
  const [editing, setEditing] = useState(null); // index sendo editado
  const [draft, setDraft] = useState({ codigo: "", nome: "" });
  const [adding, setAdding] = useState(false);
  const [newEntry, setNewEntry] = useState({ codigo: "", nome: "" });
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");

  const filtered = useMemo(() => {
    const t = search.toLowerCase().trim();
    if (!t) return table;
    return table.filter(
      (c) =>
        c.codigo.toLowerCase().includes(t) || c.nome.toLowerCase().includes(t)
    );
  }, [table, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => a.codigo.localeCompare(b.codigo));
  }, [filtered]);

  const startEdit = (index) => {
    setEditing(index);
    setDraft({ ...table[index] });
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft({ codigo: "", nome: "" });
  };

  const persistSave = async (newTable) => {
    setSaving(true);
    setSaveStatus("");
    const ok = await onSave(newTable);
    setSaving(false);
    setSaveStatus(ok ? "Salvo" : "Erro ao salvar");
    setTimeout(() => setSaveStatus(""), 2000);
  };

  const saveEdit = async () => {
    if (!draft.codigo.trim() || !draft.nome.trim()) return;
    const originalCodigo = table[editing].codigo;
    const newCodigo = draft.codigo.trim().toUpperCase();
    // Evita duplicata ao editar pra um código que já existe em outra linha
    const duplicate = table.some(
      (c, i) => i !== editing && c.codigo.toUpperCase() === newCodigo
    );
    if (duplicate) {
      alert(`Código ${newCodigo} já existe na tabela.`);
      return;
    }
    const newTable = table.map((c, i) =>
      i === editing
        ? { codigo: newCodigo, nome: draft.nome.trim().toUpperCase() }
        : c
    );
    await persistSave(newTable);
    cancelEdit();
  };

  const removeEntry = async (index) => {
    const entry = table[index];
    if (!confirm(`Remover ${entry.codigo} = ${entry.nome}?`)) return;
    const newTable = table.filter((_, i) => i !== index);
    await persistSave(newTable);
  };

  const addEntry = async () => {
    const codigo = newEntry.codigo.trim().toUpperCase();
    const nome = newEntry.nome.trim().toUpperCase();
    if (!codigo || !nome) return;
    if (table.some((c) => c.codigo.toUpperCase() === codigo)) {
      alert(`Código ${codigo} já existe na tabela.`);
      return;
    }
    const newTable = [...table, { codigo, nome }];
    await persistSave(newTable);
    setNewEntry({ codigo: "", nome: "" });
    setAdding(false);
  };

  const restoreDefaults = async () => {
    if (
      !confirm(
        "Restaurar a tabela para os valores padrão? As cores adicionadas serão removidas."
      )
    )
      return;
    await persistSave(DEFAULT_COLOR_TABLE);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8 border-b border-stone-200 pb-6">
        <div className="flex items-baseline gap-3 mb-2">
          <span className="text-xs uppercase tracking-[0.2em] text-amber-800 font-semibold">
            Cadastro
          </span>
          <span className="text-stone-300">—</span>
          <span className="text-xs uppercase tracking-wider text-stone-500">
            Sinônimos de Cor
          </span>
        </div>
        <h1 className="font-serif text-4xl font-bold text-stone-900 tracking-tight">
          Tabela de Cores
        </h1>
        <p className="text-stone-600 mt-2 max-w-2xl">
          Relaciona o <strong>código da cor</strong> do SIFAT com o{" "}
          <strong>nome da cor</strong>. Usada na conciliação quando a loja lançar
          o pedido só pelo nome (ex: "MARROM") sem o código.
        </p>
        <div className="flex items-start gap-2 mt-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <Users className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            <strong>Tabela salva no seu navegador.</strong> Cada loja precisa cadastrar suas próprias cores.
            Para compartilhar entre lojas, é necessário um banco de dados (versão futura).
          </span>
        </div>
      </div>

      {/* Barra de ações */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input
            type="text"
            placeholder="Buscar código ou nome…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-amber-700/30 focus:border-amber-700"
          />
        </div>
        <button
          onClick={() => {
            setAdding(true);
            setNewEntry({ codigo: "", nome: "" });
          }}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-amber-800 text-white rounded-md hover:bg-amber-900 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nova cor
        </button>
        <button
          onClick={restoreDefaults}
          className="flex items-center gap-2 px-3 py-2 text-sm text-stone-600 border border-stone-300 rounded-md bg-white hover:bg-stone-50"
          title="Restaurar tabela padrão"
        >
          <RotateCcw className="w-4 h-4" />
          <span className="hidden sm:inline">Padrão</span>
        </button>
        {saveStatus && (
          <div
            className={`flex items-center gap-1.5 px-3 py-2 text-xs rounded-md ${
              saveStatus === "Salvo"
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                : "bg-red-50 text-red-800 border border-red-200"
            }`}
          >
            {saveStatus === "Salvo" ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5" />
            )}
            {saveStatus}
          </div>
        )}
      </div>

      {/* Linha de adição */}
      {adding && (
        <div className="border-2 border-amber-400 bg-amber-50/50 rounded-lg p-3 mb-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Código (ex: 33302)"
            value={newEntry.codigo}
            onChange={(e) =>
              setNewEntry({ ...newEntry, codigo: e.target.value })
            }
            autoFocus
            className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white font-mono w-40 focus:outline-none focus:ring-2 focus:ring-amber-700/30"
          />
          <input
            type="text"
            placeholder="Nome (ex: MARROM)"
            value={newEntry.nome}
            onChange={(e) => setNewEntry({ ...newEntry, nome: e.target.value })}
            className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white flex-1 min-w-[180px] focus:outline-none focus:ring-2 focus:ring-amber-700/30"
            onKeyDown={(e) => {
              if (e.key === "Enter") addEntry();
              if (e.key === "Escape") setAdding(false);
            }}
          />
          <button
            onClick={addEntry}
            disabled={!newEntry.codigo.trim() || !newEntry.nome.trim() || saving}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-emerald-700 text-white rounded-md hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            Salvar
          </button>
          <button
            onClick={() => setAdding(false)}
            className="px-3 py-2 text-sm text-stone-600 hover:text-stone-900"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Tabela */}
      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
        <div className="grid grid-cols-[140px_1fr_auto] gap-3 px-4 py-2.5 bg-stone-50 border-b border-stone-200 text-[11px] uppercase tracking-wider font-semibold text-stone-600">
          <div>Código</div>
          <div>Nome da Cor</div>
          <div className="pr-2">Ações</div>
        </div>

        {sorted.length === 0 ? (
          <div className="text-center py-12 text-stone-500 text-sm">
            {search
              ? "Nenhuma cor encontrada com esse termo."
              : "Nenhuma cor cadastrada."}
          </div>
        ) : (
          sorted.map((entry) => {
            const realIndex = table.findIndex(
              (c) => c.codigo === entry.codigo
            );
            const isEditing = editing === realIndex;
            return (
              <div
                key={entry.codigo}
                className={`grid grid-cols-[140px_1fr_auto] gap-3 px-4 py-2.5 border-b border-stone-100 items-center ${
                  isEditing ? "bg-amber-50/40" : "hover:bg-stone-50/50"
                }`}
              >
                {isEditing ? (
                  <>
                    <input
                      type="text"
                      value={draft.codigo}
                      onChange={(e) =>
                        setDraft({ ...draft, codigo: e.target.value })
                      }
                      className="px-2 py-1.5 text-sm border border-stone-300 rounded bg-white font-mono w-full focus:outline-none focus:ring-2 focus:ring-amber-700/30"
                    />
                    <input
                      type="text"
                      value={draft.nome}
                      onChange={(e) =>
                        setDraft({ ...draft, nome: e.target.value })
                      }
                      className="px-2 py-1.5 text-sm border border-stone-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-amber-700/30"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit();
                        if (e.key === "Escape") cancelEdit();
                      }}
                    />
                    <div className="flex items-center gap-1 pr-1">
                      <button
                        onClick={saveEdit}
                        className="p-1.5 text-emerald-700 hover:bg-emerald-100 rounded"
                        title="Salvar"
                      >
                        <Save className="w-4 h-4" />
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="p-1.5 text-stone-500 hover:bg-stone-100 rounded"
                        title="Cancelar"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-mono text-sm text-stone-900 font-semibold">
                      {entry.codigo}
                    </div>
                    <div className="text-sm text-stone-800">{entry.nome}</div>
                    <div className="flex items-center gap-1 pr-1">
                      <button
                        onClick={() => startEdit(realIndex)}
                        className="p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-900 rounded transition-colors"
                        title="Editar"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => removeEntry(realIndex)}
                        className="p-1.5 text-stone-500 hover:bg-red-50 hover:text-red-700 rounded transition-colors"
                        title="Remover"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      <p className="text-xs text-stone-500 mt-4">
        Total: <strong>{table.length}</strong> cor{table.length === 1 ? "" : "es"} cadastrada{table.length === 1 ? "" : "s"}.
      </p>
    </div>
  );
}

function PlaceholderModule({ title, description }) {
  return (
    <div className="max-w-3xl mx-auto text-center py-20">
      <div className="inline-block p-4 bg-amber-50 rounded-full mb-4">
        <Settings className="w-8 h-8 text-amber-800" />
      </div>
      <h1 className="font-serif text-3xl font-bold text-stone-900 mb-2">{title}</h1>
      <p className="text-stone-600">{description}</p>
      <p className="text-xs uppercase tracking-widest text-amber-800 font-semibold mt-6">
        Em breve
      </p>
    </div>
  );
}

// ============================================================
// APP SHELL
// ============================================================

export default function App() {
  const [activeModule, setActiveModule] = useState("conciliacao");
  const { table: colorTable, save: saveColorTable, loaded: colorsLoaded } = useColorTable();

  const modules = [
    {
      id: "conciliacao",
      label: "Conciliação dos Pedidos com os Negativos do Sistema",
      icon: GitCompare,
      available: true,
    },
    {
      id: "cores",
      label: "Tabela de Cores",
      icon: Palette,
      available: true,
    },
    {
      id: "estoque",
      label: "Gestão de Estoque",
      icon: Package,
      available: false,
    },
    {
      id: "relatorios",
      label: "Relatórios",
      icon: BarChart3,
      available: false,
    },
    {
      id: "config",
      label: "Configurações",
      icon: Settings,
      available: false,
    },
  ];

  return (
    <div className="min-h-screen bg-stone-50" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700;9..144,800&family=Inter:wght@400;500;600;700&display=swap');
        .font-serif { font-family: 'Fraunces', Georgia, serif; }
      `}</style>

      {/* Top Bar */}
      <header className="bg-stone-900 text-stone-100 border-b-4 border-amber-700">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-amber-700 flex items-center justify-center">
              <Armchair className="w-5 h-5 text-stone-100" />
            </div>
            <div>
              <h1 className="font-serif text-xl font-bold tracking-tight leading-none">
                Sofá Show
              </h1>
              <p className="text-[10px] uppercase tracking-[0.2em] text-amber-300/80 mt-0.5">
                Operações
              </p>
            </div>
          </div>
          <div className="ml-auto text-xs text-stone-400 hidden md:block">
            21/04/2026
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 bg-white border-r border-stone-200 min-h-[calc(100vh-73px)] py-6 px-3 hidden md:block">
          <p className="text-[10px] uppercase tracking-[0.2em] text-stone-500 font-semibold px-3 mb-3">
            Módulos
          </p>
          <nav className="space-y-1">
            {modules.map((m) => (
              <button
                key={m.id}
                onClick={() => m.available && setActiveModule(m.id)}
                disabled={!m.available}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-left transition-colors ${
                  activeModule === m.id
                    ? "bg-amber-50 text-amber-900 font-semibold"
                    : m.available
                    ? "text-stone-700 hover:bg-stone-100"
                    : "text-stone-400 cursor-not-allowed"
                }`}
              >
                <m.icon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1">{m.label}</span>
                {!m.available && (
                  <span className="text-[9px] uppercase tracking-wider bg-stone-200 text-stone-600 px-1.5 py-0.5 rounded">
                    Em breve
                  </span>
                )}
              </button>
            ))}
          </nav>
        </aside>

        {/* Mobile tabs */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 flex z-10">
          {modules
            .filter((m) => m.available)
            .map((m) => (
              <button
                key={m.id}
                onClick={() => setActiveModule(m.id)}
                className={`flex-1 flex flex-col items-center py-2 text-[10px] ${
                  activeModule === m.id
                    ? "text-amber-900 font-semibold"
                    : "text-stone-600"
                }`}
              >
                <m.icon className="w-4 h-4 mb-1" />
                {m.label.split(" ")[0]}
              </button>
            ))}
        </div>

        {/* Main */}
        <main className="flex-1 p-6 md:p-10 pb-24 md:pb-10">
          {activeModule === "conciliacao" && (
            <ConciliacaoModule colorTable={colorTable} />
          )}
          {activeModule === "cores" && colorsLoaded && (
            <ColorTableModule table={colorTable} onSave={saveColorTable} />
          )}
          {activeModule === "cores" && !colorsLoaded && (
            <div className="flex items-center gap-2 text-stone-500 justify-center py-20">
              <Loader2 className="w-5 h-5 animate-spin" />
              Carregando tabela…
            </div>
          )}
          {activeModule === "estoque" && (
            <PlaceholderModule
              title="Gestão de Estoque"
              description="Visualize e controle o estoque das lojas."
            />
          )}
          {activeModule === "relatorios" && (
            <PlaceholderModule
              title="Relatórios"
              description="Indicadores gerenciais e análises de vendas."
            />
          )}
          {activeModule === "config" && (
            <PlaceholderModule
              title="Configurações"
              description="Ajustes do sistema e preferências."
            />
          )}
        </main>
      </div>
    </div>
  );
}
