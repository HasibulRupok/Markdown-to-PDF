---
title: MarkPDF sample
---

# Welcome to MarkPDF

Write **Markdown** on the left, see the *live preview* on the right, then press **Ctrl+E** to export a PDF.

## Text formatting

You can use **bold**, *italic*, ~~strikethrough~~, `inline code`, and [links](https://www.markdownguide.org).

> Blockquotes are great for notes and callouts.

## Lists

- Bulleted item
- Another item
  - Nested item

1. First
2. Second
3. Third

- [x] Write Markdown
- [x] Preview it live
- [ ] Export to PDF

## Code

```js
function greet(name) {
  return `Hello, ${name}!`;
}
console.log(greet('MarkPDF'));
```

```python
def area(r: float) -> float:
    return 3.14159 * r ** 2
```

## Tables

| Feature        | Shortcut     |
| -------------- | ------------ |
| Save           | Ctrl+S       |
| Export PDF     | Ctrl+E       |
| Find / Replace | Ctrl+F / Ctrl+H |

<!-- pagebreak -->

## A new page

Everything after a `<!-- pagebreak -->` marker starts on a new page in the PDF.

---

Footnote-style text and <kbd>Ctrl</kbd> + <kbd>S</kbd> keyboard keys also work.
