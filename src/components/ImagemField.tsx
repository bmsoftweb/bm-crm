import React, { useState } from 'react';
import { ImageOff, Trash2, Upload } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';

interface ImagemFieldProps {
  id?: string;
  /** data URI da imagem, ou "" */
  value: string;
  onChange: (dataUri: string) => void;
  rotulo: string;
  /** Guarda o arquivo como veio (ex.: imagem da campanha); sem isto, reduz para 400×200 (logo) */
  original?: boolean;
}

const LARGURA_MAX = 400;
const ALTURA_MAX = 200;
/** Original: até este tamanho vai como veio (o data URI cresce 1/3 e a requisição aceita 2 MB) */
const ORIGINAL_MAX_BYTES = 1_300_000;
/** Original grande demais: reduz para este lado maior, a resolução com que o WhatsApp manda fotos */
const ORIGINAL_LADO = 1600;

const lerDataUri = (arquivo: File) =>
  new Promise<string>((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => falha(new Error('Não foi possível ler o arquivo.'));
    r.readAsDataURL(arquivo);
  });

/**
 * Reduz a imagem para caber em 400×200 (nunca amplia) e devolve um data URI. Com `original`, devolve o arquivo
 * como veio; só o que passa de ~1,3 MB é reduzido para 1600 px no lado maior.
 * PNG preserva a transparência do logo; se ficar grande (foto), vira JPEG com fundo branco.
 */
export async function prepararImagem(arquivo: File, original = false): Promise<string> {
  if (!arquivo.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem (PNG, JPG, WebP…).');
  if (original && arquivo.size <= ORIGINAL_MAX_BYTES) return lerDataUri(arquivo);
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, falha) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => falha(new Error('O navegador não conseguiu abrir esta imagem.'));
      i.src = url;
    });
    const [largMax, altMax] = original ? [ORIGINAL_LADO, ORIGINAL_LADO] : [LARGURA_MAX, ALTURA_MAX];
    const fator = Math.min(1, largMax / img.naturalWidth, altMax / img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * fator));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * fator));
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL('image/png');
    if (png.length <= (original ? ORIGINAL_MAX_BYTES : 300_000)) return png;
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', original ? 0.85 : 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Campo de imagem (ex.: logo da empresa): prévia, envio de arquivo e remoção */
export const ImagemField: React.FC<ImagemFieldProps> = ({ id, value, onChange, rotulo, original }) => {
  const [erro, setErro] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState(false);

  return (
    <div className="flex items-center gap-4">
      <div className="h-24 w-48 shrink-0 rounded-lg border border-dashed border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/60 flex items-center justify-center overflow-hidden">
        {value ? (
          <img src={value} alt={rotulo} className="max-h-full max-w-full object-contain" />
        ) : (
          <ImageOff className="w-6 h-6 text-stone-300 dark:text-stone-600" />
        )}
      </div>
      <div className="flex flex-col gap-2">
        <label
          htmlFor={id}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer w-fit"
        >
          <Upload className="w-3.5 h-3.5" /> {value ? 'Trocar imagem' : 'Escolher imagem'}
          <input
            id={id}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={async (e) => {
              const arquivo = e.target.files?.[0];
              e.target.value = ''; // permite escolher o mesmo arquivo de novo
              if (!arquivo) return;
              setErro(null);
              try {
                onChange(await prepararImagem(arquivo, original));
              } catch (err: any) {
                setErro(err.message);
              }
            }}
          />
        </label>
        {value && (
          <button
            type="button"
            onClick={() => setRemovendo(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer w-fit"
          >
            <Trash2 className="w-3.5 h-3.5" /> Remover
          </button>
        )}
        {erro && <p className="text-[11px] text-rose-600">{erro}</p>}
      </div>

      {removendo && (
        <ConfirmDialog
          titulo={`Remover ${rotulo.toLowerCase()}?`}
          mensagem="A imagem sai do formulário. A remoção só vale depois de salvar."
          confirmar="Remover"
          onConfirmar={() => {
            onChange('');
            setRemovendo(false);
          }}
          onCancelar={() => setRemovendo(false)}
        />
      )}
    </div>
  );
};
