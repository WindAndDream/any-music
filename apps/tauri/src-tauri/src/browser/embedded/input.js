// Native code evaluates one method per CDP Input command. Inputs act only on the hit target.
// oxlint-disable unicorn/consistent-function-scoping -- Rust embeds this self-contained object.
// oxlint-disable-next-line no-unused-expressions -- Rust evaluates this expression.
;({
  insert(text) {
    const target = document.activeElement
    // execCommand produces the browser's own beforeinput/input events for controlled fields.
    if (document.execCommand('insertText', false, text) && target?.value === text) return true
    // An unfocused hidden page may refuse editing commands; use the field's native setter.
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return false
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value')?.set?.call(target, text)
    target.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: text,
      }),
    )
    return target.value === text
  },
  click(x, y) {
    const target = document.elementFromPoint(x, y)
    if (!target) return false
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      view: window,
    }
    const pointer = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }
    target.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, buttons: 1 }))
    target.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }))
    target.dispatchEvent(new PointerEvent('pointerup', pointer))
    target.dispatchEvent(new MouseEvent('mouseup', base))
    target.dispatchEvent(new MouseEvent('click', base))
    return true
  },
  wheel(x, y, delta) {
    const target = document.elementFromPoint(x, y)
    if (!target) return false
    const allowed = target.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        deltaY: delta,
        deltaMode: 0,
        view: window,
      }),
    )
    if (!allowed) return true
    // Scroll the nearest scroll container under the point, as a native wheel would.
    let element = target
    while (element && element !== document.body && element !== document.documentElement) {
      if (
        element.scrollHeight > element.clientHeight + 1 &&
        /auto|scroll/.test(getComputedStyle(element).overflowY)
      )
        break
      element = element.parentElement
    }
    const container =
      element && element !== document.body && element !== document.documentElement
        ? element
        : document.scrollingElement
    container?.scrollBy({ top: delta, behavior: 'instant' })
    return true
  },
})
