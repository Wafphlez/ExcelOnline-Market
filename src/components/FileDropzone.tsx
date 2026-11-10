import { FileSpreadsheet, Upload } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

type FileDropzoneProps = Readonly<{
  onFile: (file: File) => void
  disabled?: boolean
  /**
   * Имя уже выбранного файла. Пустая строка — файл не выбран.
   * Если проп не передан, зона помнит последний принятый файл сама.
   */
  fileName?: string | null
  /**
   * Вложен в общую карточку: меньше отступы, спокойнее граница.
   * @default false
   */
  embedded?: boolean
}>

export function FileDropzone({
  onFile,
  disabled,
  fileName,
  embedded = false,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const [localName, setLocalName] = useState<string | null>(null)
  const shownName = (fileName !== undefined ? fileName : localName)?.trim() || null

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (!list?.length) return
      const f = list[0]
      if (f && /\.(xlsx|xls)$/i.test(f.name)) {
        setLocalName(f.name)
        onFile(f)
      }
    },
    [onFile]
  )

  if (embedded) {
    return (
      <div
        role="presentation"
        onDragEnter={() => setDrag(true)}
        onDragLeave={() => setDrag(false)}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          if (disabled) return
          handleFiles(e.dataTransfer.files)
        }}
        className={`${disabled ? 'pointer-events-none opacity-50' : ''}`}
      >
        <label className="block shrink-0">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            disabled={disabled}
            onChange={(e) => handleFiles(e.target.files)}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-eve-accent/70 bg-eve-accent-muted px-4 py-2 text-xs font-semibold text-eve-accent transition-colors hover:border-eve-accent hover:bg-eve-highlight focus:outline-none focus:ring-2 focus:ring-eve-accent/35 disabled:opacity-50"
            title="Импорт .xlsx/.xls"
            aria-label="Импорт .xlsx/.xls"
          >
            <Upload className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Импорт</span>
          </button>
        </label>
      </div>
    )
  }

  return (
    <div
      role="presentation"
      onDragEnter={() => setDrag(true)}
      onDragLeave={() => setDrag(false)}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        if (disabled) return
        handleFiles(e.dataTransfer.files)
      }}
      className={`glass-panel rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors ${
        drag
          ? 'border-eve-accent/85 bg-eve-highlight glow-kpi'
          : 'border-eve-border/85 bg-eve-surface/45'
      } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
    >
      {shownName ? (
        <FileSpreadsheet
          className="mx-auto mb-2 h-8 w-8 text-eve-accent"
          aria-hidden
        />
      ) : (
        <Upload
          className="mx-auto mb-2 h-8 w-8 text-eve-accent/80"
          aria-hidden
        />
      )}
      {shownName ? (
        <>
          <p className="eve-kicker mb-1">Файл выбран</p>
          <p
            className="mb-3 truncate text-sm font-semibold text-eve-bright/95"
            title={shownName}
          >
            {shownName}
          </p>
        </>
      ) : (
        <p className="mb-3 text-sm font-semibold text-eve-bright/95">
          Перетащите сюда файл .xlsx или нажмите кнопку
        </p>
      )}
      <label className="inline-block">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          disabled={disabled}
          onChange={(e) => handleFiles(e.target.files)}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="rounded-md border border-eve-accent/85 bg-eve-accent px-4 py-2 text-sm font-bold uppercase tracking-wider text-eve-bg shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] hover:bg-eve-accent-hover focus:outline-none focus:ring-2 focus:ring-eve-accent/50 focus:ring-offset-2 focus:ring-offset-eve-bg disabled:opacity-50"
        >
          {shownName ? 'Заменить .xlsx' : 'Выбрать .xlsx'}
        </button>
      </label>
    </div>
  )
}
