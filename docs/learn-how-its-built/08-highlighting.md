# 08 · Highlighting

Open your `.logo` file in an editor and every piece of it lights up in a different color: keywords
in one shade, numbers in another, commands in a third. That's **syntax highlighting** — and it's
the same idea as using different highlighter pens on your notes: one color for dates, one for
names, one for definitions, so your eyes can spot what's what before you even read the words.

OpenLogo does this by reusing the exact same tools that already understand your code — the
**lexer** and the **parser** (the tree-builder from earlier pages) — instead of guessing from
patterns. That matters: a pattern-guesser might get confused and color a variable named `printer`
as if it were the command `print`. OpenLogo never does, because it isn't guessing — it's asking the
lexer and the tree what each piece of your code actually *is*.

Run OpenLogo's real highlighter on our square, `repeat 4 [ forward 100 right 90 ]`, and here's
exactly what comes back:

```mermaid
flowchart LR
  A["repeat<br/>keyword"] --> B["4<br/>number"] --> C["[<br/>bracket"] --> D["forward<br/>primitive"] --> E["100<br/>number"] --> F["right<br/>primitive"] --> G["90<br/>number"] --> H["]<br/>bracket"]
```

Two things worth noticing:

- `repeat` gets the **keyword** color and `forward`/`right` get the **primitive** color — the same
  keyword-vs-primitive split from the tokens page, now painted as actual colors instead of just
  labels.
- The `[` and `]` aren't just "a bracket" — the highlighter also knows their **role**. Here it's
  `instruction-block`, because this particular pair wraps a bundle of instructions to repeat. A
  different pair of brackets, wrapping a plain list of numbers like `[ 1 2 3 ]`, would get the role
  `list` instead. The highlighter figures out the role by looking at the *shape* of the tree around
  the brackets, not just the bracket character itself — that's only possible because it's reusing
  the parser's tree, not scanning text.

OpenLogo recognizes **15 token classes** in total — our square only uses four of them (`keyword`,
`number`, `primitive`, and `bracket`) — and that bracket pair also carries a **role**,
`instruction-block`, on top of its class. Think of a role like an actor playing a different part in
each movie: the same `[ ]` characters play "the hero" (an instruction block) in one program and "the
villain" — er, "an ordinary list" — in another, depending on the tree around them. Bigger programs
light up more classes: your own procedure names get their own color once you `define` them, and
`:variable`s, words, and comments each get one too.

## Some words only become keywords when their part of the language is switched on

A few words — `tell`, `ask`, `each`, `when`, `every`, `on_key`, `on_click` — belong to optional
parts of OpenLogo (Sprites, and Interaction & Events). They only get the **keyword** color when the
part of the language they belong to is actually switched on. Where it isn't, `ask` falls back to the
plain **primitive** color — and that fallback is deliberately modest: it says only "a name goes
here," not "this is a built-in you can call." Painting it as a keyword there would promise a feature
that isn't switched on.

So the highlighter has to be *told* which parts are switched on. In the OpenLogo studio it's told
"all the ones this build supports" — the same list the checker uses when it decides whether a
command is one you can actually use here. That shared list is the whole point: it would be confusing
if the editor painted `ask` as a plain unknown-ish word while the checker was perfectly happy to run
it.

(Switching a part off doesn't make its words available for your own procedure names, by the way. All
of them stay reserved everywhere, so nobody can write a program that works in one OpenLogo and
mysteriously breaks in another. What a part being switched on decides is whether a word *works* —
never whether you're allowed to name something after it.)

Careful, though: switching Sound on does **not** turn `beep` or `note` into keywords. Those are
ordinary commands, like `forward` — they take their arguments and get on with it. The words that do
become keywords are the ones that *hold a block of other instructions*, like `repeat`, `if`, and
`ask`. `tell` is the one exception that proves the rule: it holds no block, but it changes **who**
the instructions after it are talking to, and steering the program like that is keyword work.

## What's real today

✅ **Highlighting is grammar-derived, not guesswork** — it reuses the real lexer and the real tree
(the parser's output), so a variable named `printer` is never colored as if it were the command
`print`. (It isn't perfect yet: a *keyword* used as a name — `local if` — is still painted as a
keyword today. Teaching the highlighter about those positions is its own piece of work.)

✅ **Bracket roles are real** — the `[ ]` around our square's repeat block is correctly classified
`instruction-block`, distinct from an ordinary list.

✅ **The studio's colors know which parts of the language are on** — the editor classifies under the
profiles this build supports, so `ask` reads as the keyword it is.

ℹ️ **The code blocks in these docs are not colored by OpenLogo** — the `.logo` snippets you read on
GitHub are painted by GitHub's own markdown renderer, not by OpenLogo's highlighter. The docs
toolchain checks every one of those snippets, and runs the ones whose parts of the language are
built yet, but it never *colors* one — so there's nothing here that needs telling which parts are
switched on.

ℹ️ **A few classes need the tree, not just tokens** — most classes (keyword, number, primitive,
bracket, and more) can be decided token-by-token. A handful, like the name of a procedure you
`define` yourself, need the tree too, so OpenLogo can tell "this is the name being *defined*" apart
from "this is the name being *called*."

## Try it yourself

Open any `.logo` file in an editor with OpenLogo highlighting and look closely: `define`, `if`, and
`repeat` should all share one color (keywords), while `forward`, `print`, and `right` share another
(primitives) — even though, to your eyes, they're all "just words."

**Next up →** [09 · The checker](09-the-checker.md)
