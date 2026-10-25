import React, { useRef, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { prepararImagem } from './ImagemField';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * Print no chat do suporte (widget SuportePublico e tela do técnico Chamados): clipe para escolher a imagem,
 * Ctrl+V no campo da mensagem e a prévia antes de enviar. A imagem vai como data URI já reduzida (até 1600 px).
 */

/** Imagem do Ctrl+V (print da tela), reduzida; null = colou texto */
export async function imagemColada(e: React.ClipboardEvent): Promise<string | null> {
  const arquivo = Array.from(e.clipboardData.files as ArrayLike<File>).find((f) => f.type.startsWith('image/'));
  if (!arquivo) return null;
  e.preventDefault();
  return prepararImagem(arquivo, true);
}

export const BotaoClipe: React.FC<{ onImagem: (dataUri: string) => void; onErro: (msg: string) => void; disabled?: boolean; className?: string }> = ({
  onImagem,
  onErro,
  disabled,
  className,
}) => {
  const arquivo = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => arquivo.current?.click()} title="Enviar imagem (ou cole um print com Ctrl+V)" aria-label="Enviar imagem" className={className}>
        <Paperclip className="w-4 h-4" />
      </button>
      <input
        ref={arquivo}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            onImagem(await prepararImagem(f, true));
          } catch (err: any) {
            onErro(err.message);
          }
        }}
      />
    </>
  );
};

/** Prévia da imagem que vai na próxima mensagem; tirar pede confirmação */
export const PreviaImagem: React.FC<{ src: string; onRemover: () => void }> = ({ src, onRemover }) => {
  const [removendo, setRemovendo] = useState(false);
  return (
    <div className="relative self-start">
      <img src={src} alt="Imagem a enviar" className="h-20 max-w-[12rem] rounded-lg border border-stone-200 dark:border-stone-700 object-cover" />
      <button
        type="button"
        onClick={() => setRemovendo(true)}
        title="Tirar a imagem"
        aria-label="Tirar a imagem"
        className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-stone-700 text-white flex items-center justify-center cursor-pointer hover:bg-rose-600"
      >
        <X className="w-3 h-3" />
      </button>
      {removendo && (
        <ConfirmDialog
          titulo="Tirar a imagem?"
          mensagem="A imagem não vai mais junto com a mensagem."
          confirmar="Tirar"
          onConfirmar={() => {
            setRemovendo(false);
            onRemover();
          }}
          onCancelar={() => setRemovendo(false)}
        />
      )}
    </div>
  );
};
