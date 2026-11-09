# UI rules

One design language for every page. Consistency beats any single clever idea: a new view uses
the components named here instead of styling its own. The rules hold in both themes and on a
phone.

## Selection

- **Tiles and cards** that can be chosen (dataset cards, the assignment rules, the datasets of a
  comparison) use `choiceTile` from `components/ui/choice.tsx`: a neutral surface, a 1.5 px
  accent ring once chosen, and the check mark (`ChoiceMark`) beside the name. `ChoiceCard`
  (`components/ui/choice-card.tsx`) is such a card with its (i) in the corner. The entry on screen
  in a list of links (the recent runs of a single log) has the same ring.
- **Every Segmented control** (`components/ui/segmented.tsx`: view toggles, filters, the source
  of the data, language, theme, the toggles of the workbench) has one look: the chosen option is a
  raised neutral pill (a lighter fill and a small shadow, no ring: rings belong to chosen tiles).
  There is no variant.
  It is a `radiogroup` like the tiles: one tab stop on the chosen option (roving tabindex), the
  arrow keys move to the next option and choose it, Home and End jump to the first and the last.
- No solid accent fills for a selection. The small check mark of a chosen tile is the only filled
  accent shape, and a switch that is on.

## Colour

- The accent (pink) marks the one primary action of a view, links, focus rings, the underline of
  the active tab, the ring of a chosen tile and the marker of the current step. A run in progress
  (the activity line of the History, a progress bar) is the one other use.
- Data have their own colour, `--data` (blue), never the accent (a red reads as "bad"): the loadings
  matrix shades by |loading| in it, whatever the sign (the sign of a factor is arbitrary), and so
  do the line of the scree plot and the bars of the fact sheet. Where the sign means something (the
  correlation map, the correlations of the factors) negative is slate (`--negative`), positive `--data`.
- Decorative icons sit on a neutral tile in the muted colour, never on an accent tint.
- Warning and danger colours always come with a glyph (`AlertTriangle`, `AlertCircle`), never as
  colour alone.
- Done is a quiet success tone with a check.
- Edges and surfaces come from the tokens, never from a fixed grey: `--border` (about 2:1 on a
  surface) is the edge of a card and a section, `--line` the fainter separator between table rows,
  `--border-strong` (3:1) the boundary of anything that is a control on its own (the dashed drop
  zone), `--chart-grid` the grid of a chart. A tour or a chart takes the same tokens.
- A disabled button is a tile with muted text, not the accent colour at half strength, and shows
  `not-allowed`. A notice has a 3 px edge in its tone (warning, error, success) besides the tint.

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
- The guide (`/guide`) is long-form on purpose, laid out for scanning: one card per section with its
  lead line, its items (steps, the results with the signs of the step rail, or tiles) and a quiet note
  on the rest. The contents are a sticky column from `lg` on, with a thin accent bar at the section
  being read, and a row of chips above the cards below it.

## Error messages

- The backend gives every failure of a dataset or an upload a stable `error_code` (the dataset)
  or `code` (the upload) with `params`, next to the English text, which stays for compatibility.
- The UI maps the code to a plain sentence that names the cause and the fix: `errors.<code>` in
  both locales (`plainFailure` in `lib/factor-analysis.ts`). The technical text goes behind an (i)
  "Details". Library wording (pandas, lxml, a Python exception) is never the main message; a code
  without a sentence gets the generic one and the text as details.
- A computation the user stopped is not a failure: the dataset is `aborted`, shown neutrally as
  "Abgebrochen", with "Erneut berechnen" where its sample is still there, else "Löschen" and
  "Andere Daten wählen". A dataset without data is never offered "Datensatz öffnen".
- A notice of a failure offers "Problem melden" (`ReportProblem` in `components/feedback/`): it opens the
  feedback dialog as a bug, with the code of that error among the technical details. The dialog has
  one primary action, "Senden", and says what goes along behind an (i); nothing else is sent.
- What is known to fail is not asked of the server: with no more observations than measures the
  hint of Eignung is shown directly, so the console has no 400.

## Text and targets

- **Orientation text is never smaller than 12 px** (`text-xs`, 0.75rem): the summaries of the step
  list, the cells and notes of the comparison, the activity line of the History. A new view does
  not use `text-[10px]` or `text-[11px]` for anything a reader needs.
- **Every control has a hit area of at least 24 px** (WCAG 2.5.8): the small text buttons
  (Alle, Keine, Standard), the back links and the (i) of `InfoTip`, whose glyph stays small and
  whose button is 24 px with a negative margin, so the line keeps its height.
- On a touch screen (`pointer: coarse`) buttons, stand-alone links and checkbox labels in `main`
  get a minimum height of 24 px from `globals.css`; switches keep their size. Strips that scroll
  sideways (source tabs, filters, code blocks) fade at the edge where more lies beyond. An (i)
  popover never leaves the window: it moves up as far as needed and scrolls inside itself.
  Where the result of a view can change height (the comparison), it keeps the height it had, so
  nothing below it shifts. Header and toolbar icons are 8 px apart.
- A text that is cut off with an ellipsis (a summary in the step list) shows all of it in the
  two-stage tooltip. The row of settings chips wraps instead of scrolling.
- Headings are never empty, a dialog has a name (`aria-labelledby`), a region that scrolls sideways
  (a code block) takes the focus (`tabIndex=0`, `role="region"`, `aria-label`), and every page
  has an `h1`. The first stop of the keyboard on every page is the "Zum Inhalt springen" link.

## Structure of a page

- `PageHeader`: the title and at most one short subtitle line, or none; the page's toolbar sits
  right of the title.
- Cards (`components/ui/card.tsx`) have the same padding (`px-4 sm:px-5`, `py-5`) and radius
  (`rounded-lg`) everywhere.
- At most **one primary button** per view (`Button` with the default variant). Everything else is
  secondary, outline or ghost.
- Empty states use `EmptyState` (`components/ui/empty-state.tsx`); the 404 page is one, with
  a button to the start page.
- The info pages (settings, guide) share one column (`PAGE_COLUMN` in
  `components/ui/page-column.tsx`), centred in the content area that the header, the tabs and the
  other pages share (`max-w-[1600px]`).
- A section of a page has a plain heading, no numbered badge: a number in a circle means a step
  of the stepper and nothing else. A title appears once: the matrix under the step "Ladungen"
  is the "Ladungsmatrix".
- Where a reference to the paper (a table number, the report) is not needed to read a choice, it
  is in the tip of the choice, not in its visible text.
- Notices (info, warning, error, confirmation) use `Notice` (`components/ui/notice.tsx`): an icon,
  a tinted box, aligned with the content around it, never bare text at the left edge.

## Navigation

- The mode bar has two groups: the analyses (model complexity, log complexity, single log) with
  icon and label, and, set apart on the right, the tools of the app (comparison, history),
  smaller. **There is no description line under a tab:** what a tab is for is its tooltip.
- Below `lg` the tools are icons, with the label as tooltip and as `aria-label`; the divider
  between the groups stays. From 380 px all five entries are visible without scrolling (the tabs
  of the analyses put the icon above the label on a phone). Below 380 px the bar keeps the width
  of its entries and scrolls sideways, fading at the edge where more entries lie beyond it.
- The loadings open on **Dimensionen**; the matrix is one click away, and `?view=matrix` in the
  address opens it (the default has no parameter). A factor without a name of its own is labelled
  with the measure that loads highest on it ("Faktor 1 · Size").
- Exactly one entry is marked per route; on the pages of the header the header link is.
- The feedback entry in the header is a button, not a page: it has no marked state, shows the icon
  below `lg` and the name from `lg` on, and opens the feedback dialog (a `Sheet`).
- The steps of an analysis are a stepper: a round numbered marker per step, a line between them,
  the title and one short summary line. Done steps show a check, a step with a warning its glyph,
  the current step an accent ring; upcoming steps are muted, without a lock.
