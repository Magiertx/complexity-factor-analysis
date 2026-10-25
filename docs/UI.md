# UI rules

One design language for every page. Consistency beats any single clever idea: a new view uses
the components named here instead of styling its own. The rules hold in both themes and on a
phone.

## Selection

- **Tiles and cards** that can be chosen (dataset cards, the assignment rules, the datasets of a
  comparison) use `choiceTile` from `components/ui/choice.tsx`: a neutral surface, a 1.5 px
  accent ring once chosen, and the check mark (`ChoiceMark`) beside the name.
- **Every Segmented control** (`components/ui/segmented.tsx`: view toggles, filters, the source
  of the data, language, theme, the toggles of the workbench) has one look: the chosen option is a
  raised neutral pill (surface, small shadow, a ring in the border colour). There is no variant.
- No solid accent fills for a selection. The small check mark of a chosen tile is the only filled
  accent shape, and a switch that is on.

## Colour

- The accent (pink) marks the one primary action of a view, links, focus rings, the underline of
  the active tab, the ring of a chosen tile and the marker of the current step.
- Warning and danger colours always come with a glyph (`AlertTriangle`, `AlertCircle`), never as
  colour alone.
- Done is a quiet success tone with a check.

## Help

- A section shows its title and at most **one short line** (aim for 12 words or fewer).
- Anything longer goes behind **one component**, `InfoTip` (`components/ui/info-tip.tsx`): a small
  (i) beside the title or label. Resting the pointer on it or focusing it shows the explanation in
  the tooltip; a click or a tap opens it in a small popover, which works on touch and closes with
  Escape. `InfoLabel` is a title or label with its (i).
- No dotted underlines and no `cursor: help`. A label that explains something gets an (i).
- The explanations are the existing i18n texts; only what is visible is shortened. German texts
  address the reader with "du".
- Icons name themselves through the tooltip (`useTip`, `IconButton`); that is not help text.
- The guide (`/guide`) is long-form on purpose.

## Structure of a page

- `PageHeader`: the title and at most one short subtitle line, or none; the page's toolbar sits
  right of the title.
- Cards (`components/ui/card.tsx`) have the same padding (`px-4 sm:px-5`, `py-5`) and radius
  (`rounded-lg`) everywhere.
- At most **one primary button** per view (`Button` with the default variant). Everything else is
  secondary, outline or ghost.
- Empty states use `EmptyState` (`components/ui/empty-state.tsx`).
- Notices (info, warning, error, confirmation) use `Notice` (`components/ui/notice.tsx`): an icon,
  a tinted box, aligned with the content around it, never bare text at the left edge.

## Navigation

- The mode bar has two groups: the analyses (model complexity, log complexity, single log) with
  icon, label and a description line from `sm` on, and, set apart on the right, the tools of the
  app (comparison, history), smaller and without a description line.
- Exactly one entry is marked per route; on the pages of the header the header link is.
- The steps of an analysis are a stepper: a round numbered marker per step, a line between them,
  the title and one short summary line. Done steps show a check, a step with a warning its glyph,
  the current step an accent ring; upcoming steps are muted, without a lock.
