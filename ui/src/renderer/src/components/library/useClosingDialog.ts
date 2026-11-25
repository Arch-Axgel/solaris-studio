import { useCallback, useEffect, useRef, useState } from 'react'

/** For a dialog component that its parent mounts while it should show and
 *  unmounts in onClose: keeps the native <dialog> open, and on close plays
 *  the exit transition first, then calls the parent's onClose. */
export function useClosingDialog(onClose: () => void, exitMs = 300): [boolean, () => void] {
  const [open, setOpen] = useState(true)
  const latest = useRef(onClose)
  latest.current = onClose
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const close = useCallback((): void => {
    if (timer.current) return
    setOpen(false)
    timer.current = setTimeout(() => latest.current(), exitMs)
  }, [exitMs])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  return [open, close]
}
