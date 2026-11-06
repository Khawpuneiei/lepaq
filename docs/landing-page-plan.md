# Landing page: production plan

Written 5 Nov 2026 for PR #7 (`claude/project-thread-9uvfg2`), the scroll-story
landing page at `/`. This plan lists everything that has to be true before the
page is public, what this PR changes, and what is left for a decision.

**Status key.** **This PR**: changed and checked on this branch. **Decide**: needs
a call from P or the team; the fix is written out below. **Later**: worth doing,
not needed for launch.

## 1. Summary

The story itself works: lint, typecheck and build pass, and it was checked at
1440, 1280, 1024, 768, 390 and 320 wide with keyboard and reduced motion. An audit
for production found five kinds of gap:

1. **Some claims were not true of the app.** The worst: the page says a follow-up
   lands on the page of the person who asked, but the app files it on your list
   and the company's page only; "everything stays a draft" while emotion reads
   and coaching show before approval; 14.8% is a near-mic score, and Lepaq runs
   room mode by default.
2. **The landing page depends on Supabase.** `proxy.ts` runs a session check
   before `/`, so a paused or slow Supabase project can make the landing page
   wait about 25 seconds or show a 503, and every visit costs a function call.
3. **It does not share well.** No preview image, no canonical URL, no robots.txt
   or sitemap (both currently redirect to the sign-in page), and shared meeting
   summaries at `/s/...` are not marked noindex.
4. **Some readers cannot read the story.** On landscape phones and at 200% zoom
   the pinned header and stage cover the whole screen, so no chapter text is
   ever visible. Focus rings are too faint and vanish in Windows high contrast.
   Chrome's Translate crashes the page when you scroll back up.
5. **Two leaks on the way in.** `/login?next=` redirects anywhere after sign-in
   (open redirect), and the public sign-in page prints `OWNER_EMAIL` into its
   HTML whenever that variable is set on Vercel.

This PR fixes all five within the landing page and the pages it links to, and
adds `npm run check:landing` to keep them fixed. An independent review of the
finished branch then found twelve more problems, among them a way round the
sign-in redirect fix, share links that unfurled as the landing page, and a
stage that still cut off its Approve button at large text sizes (section 4.6).
A sweep of window and text sizes found five more, four of them with large text
on phones (section 4.7). A second review of the whole branch, and testing its
fixes with the scrollbars Windows draws, turned up ten more (section 4.8): two
Back-button cases, three earlier fixes that had traded one layout fault for
another or left a band of window heights uncovered, words breaking where a
flight lands, and four gaps in the checks themselves. A third review of what
those fixes changed found seven more, all minor (section 4.9): the opening
still crossing the quote once a reader starts to scroll on a short desktop, a
band of tablet-width stages that cut off Approve, the closing picture of the
app at large text, a reload at the top that jumped to a chapter, and three
gaps in the checks. A fourth look, at only what the third review changed,
found four more, all minor (section 4.10): the header's logo doing nothing on
the page itself, a rule of the third review's that hid a line on Jamie's page
where it fitted, and two gaps in the checks. All of them are fixed. Section 5
leaves nine decisions: D1 for P (done here the recommended way, and easy to
swap), and eight for the team about how the app itself behaves.

## 2. How the findings were made

Five auditors each took one area (claims, performance, accessibility, story
robustness, SEO/config/privacy), read the code and reproduced every problem in
Chromium against the production build, at the sizes and settings named in each
row. A second agent per area then tried to refute each finding and re-measured
it. 75 findings survived (several overlap and are merged below); 5 were refuted
and are listed in section 8.

Once the plan was built, four reviewers read the whole diff (story and CSS;
server and config; claims; checks and docs), each reproducing what they found,
and a skeptic per finding tried to refute it. 18 of 28 findings held up; they
are merged into the twelve rows of section 4.6, and the 10 refuted ones are in
section 8.

Then a sweep of 64 window and text sizes found a page pushed sideways at
200% text on a 320px phone. A probe written for it, which looks for stage
text that is cut off or runs out of its card, found the rest of section 4.7.

After that, four reviewers read the whole branch again (story and CSS; history
and server; claims and docs; the checks) with a skeptic per finding, as
before. 7 of their 9 findings held up. The skeptics judged the other two,
REV-14 and REV-21, not to be defects today, and both are hardened anyway; the
checks skeptic found one more, REV-22. The fixes were then tested in a browser
that draws classic scrollbars, as Windows does; headless Chrome hides them and
so gives the page about 15px more width than most desktop visitors have. That
found REV-18.

Then a third review: two reviewers (layout; checks) read only what the
second review's fixes changed, measured each claim in a browser, and a
skeptic per finding tried to refute it with probes of their own. All seven
findings held up, and the skeptics rated all but one low (section 4.9).
Each check added for them was run against the build before its fix and
failed there, 28 of the 48 runs of the tight and Back parts, except REV-27's:
nothing on this build breaks a flight's words, so it was run with CSS that
lets a title wrap, and caught it where the old count did not.

Last, a fourth review: three reviewers (layout; history; checks) looked only
at what the third review changed, each reproducing what they found in a
browser, with a skeptic per finding (section 4.10). The history reviewer found
nothing wrong in those changes, and one older fault, REV-29; the skeptics
confirmed the other three, except REV-32's point about a blend mode on the
card: the chapters' list keeps that within its own stacking context. The
checks added for REV-29 and REV-30 failed on the build before their fixes.
REV-31's and REV-32's were tried against the faults they guard (a looping
animation in the closing picture; a fade on the opening's list item, an
opacity filter, a blend on the chapters' list), where the old check hung or
passed, and against look-alikes that are fine (a scroll-driven drift, a drop
shadow, a blend on the card), which pass. What the reviewers saw and left out
is in section 8.

Limits: Chromium only, no WebKit or real phones, and a fake Supabase project, so
app queries were checked by reading the code, not against real data. The new
`check:pages` test for D1 has only run against a stand-in Supabase, where it
fails when the follow-up is missing or the attendee lookup fails, and passes
when the follow-up is listed.

## 3. What must be true before launch

| | Must be true | Where |
|---|---|---|
| 1 | Every claim on the page is something the app does today | Section 4.1 and decision D1 |
| 2 | `/` loads without the proxy or Supabase | PROXY-1 |
| 3 | A shared link shows the title, description and image | SEO-1, SEO-2 |
| 4 | Every chapter is readable at 200% zoom and on a landscape phone | A11Y-1 |
| 5 | The sign-in page leaks no email and redirects only to Lepaq | SEC-3, MISS-1 |
| 6 | Vercel production has the right variables (section 6) | Release checklist |

## 4. Workstreams

### 4.1 Every claim true

| ID | What is wrong | Fix | Status |
|---|---|---|---|
| CC-1 | "Filed with the person who asked": the app sets a follow-up's person from its owner, so your own follow-up never reaches Jamie's page | Decision D1. Recommended and done here: Jamie's page also lists open follow-ups from meetings she was in (`app/(app)/people/[id]/page.tsx`), so the story stays | This PR, pending D1 |
| CC-2 | "Everything the AI writes stays a private draft": emotion reads and coaching show on the person page and dashboard before approval | Narrowed to what is true: follow-ups and facts wait for your approval. Same change on the sign-in page. The app fix is D2 | This PR |
| CC-3 | "Health, religion, politics, ethnicity, sexuality and money are blocked in the prompt, the code and the database": only fact categories are blocked, the list is wrong, and a sensitive fact under a harmless key can still be saved | Says what is enforced: the AI is told not to file those topics as facts, the code and database refuse those categories, and no fact reaches a profile until you tick it | This PR |
| CC-4 | 14.8% on SASRBench is near-mic mode; Lepaq sends room mode by default | The stats lead with room mode, the one Lepaq records with: "4 of 4" NSC conversation sets (Parts 3 to 6) and 76% of particles. The 14.8% says it is near-mic mode, which scores only the mic wearer, and gives room mode's 17.1% beside it (REV-9) | This PR |
| CC-6 | "WhisperLah ... tells the voices apart": Whisper does not label speakers; a separate speaker model does | "...writes the transcript, and a separate speaker model tells the voices apart" | This PR |
| CC-7 | "Confirming the other side is happy for you to take notes": the app asks whether everyone knew they were being recorded | Uses the app's own consent wording and says nothing is uploaded before it | This PR |
| CC-8 | The MERaLiON-2-10B comparison drops that it ran in 4-bit | Says "run in 4-bit" | This PR |
| CC-9 | Read-speech footnote names only A*STAR; five models beat WhisperLah on NSC Part 1 and two on Part 2 | Names them | This PR |
| CC-10 | The benchmark sits under a coffee-chat story, but every test set is quiet close-mic audio | Label becomes "How Lepaq hears Singlish"; footnote says café noise is not benchmarked yet | This PR |
| CC-12 | "A share link shows only the summary": it also shows takeaways, decisions and ticked follow-ups with names and dates | Lists exactly what a share link shows and never shows | This PR |
| CC-13 | "Untick what is wrong": facts need a tick, so untick-only saves no facts; "2 facts to save" | "Untick the follow-ups that are wrong, tick the facts worth keeping"; "2 facts to review" | This PR |
| CC-14 | Status lines show raw enums (`awaiting_speakers`) | Uses the app's labels ("Check speakers", "Needs review", "Approved"), with a spoken version | This PR |
| CC-15 | "Most speech models were built for American English on video calls": nothing measures that | Replaced with a measured fact: base Whisper writes down 10% of the lah, leh and lor in conversation | This PR |
| CC-16 | The chart reads as a full ranking but leaves out four models ahead of the ones shown | Caption says "selected models; all 18 are on GitHub" and spells out NSC | This PR |
| CC-17 | Privacy intro "notes clearly belong to them" reads as the client's | "...you only record a client if the notes are clearly yours. In Lepaq, they are." | This PR |
| CC-20 | README landing section is out of date and does not point to the owner's claim review | Updated, with the rule to check copy against `pitch-deck/overclaim-review.md` (in the project files) | This PR |
| CC-21 | "Meet someone twice and it is still one page": a second Jamie with no company becomes a second page | "Pick Jamie from your people next time, or use the same name and company..." | This PR |
| CC-M1 | The owner's claim review asks to "say where audio is processed"; the page never does | Privacy section names Modal (US East) for transcription and Anthropic's Claude for the report | This PR |
| CC-M2 | A voiceprint of everyone in the room is kept for every meeting; nothing reads it | Decision D3 | Decide |
| CC-M3 | Deleting a meeting leaves its recording (if not yet deleted) and its unapproved fact drafts | Decision D4 | Decide |
| CC-11, MISS-2 | No privacy notice or terms; `/privacy` redirects to sign-in | Decision D5 (needs counsel) | Decide |

### 4.2 Loads without the database, and shares well

| ID | What is wrong | Fix | Status |
|---|---|---|---|
| PROXY-1, PERF-1 | The proxy runs `supabase.auth.getUser()` before `/`. With an expired cookie and Supabase down, `/` waits about 25 s; a missing variable makes it a 503 | The matcher skips `/` and its prefetch forms (`/index.rsc`, `/index.segments/...`), and the `/demo` walkthrough the page links to (REV-2) | This PR |
| SEO-3 | `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest` and `/.well-known/*` redirect to sign-in | Matcher skips them; `app/robots.ts` and `app/sitemap.ts` added | This PR |
| SEO-1 | No preview image; the page-level `openGraph` block would hide one anyway | `app/opengraph-image.png` (1200x630) with alt text; site name and locale in the root metadata; the page block removed so the image applies | This PR |
| SEO-2 | No `metadataBase` or canonical | `lib/site.ts` reads `NEXT_PUBLIC_APP_URL` (or Vercel's production URL) and never throws; canonical on `/`, `/demo` and `/login` | This PR |
| PRIV-1 | Shared summaries at `/s/...` can be indexed | `noindex, nofollow` in the page metadata and an `X-Robots-Tag` header | This PR |
| SEC-1 | No security headers | Site-wide `nosniff`, `Referrer-Policy`, `X-Frame-Options: SAMEORIGIN` (the walkthrough frames itself) and a `Permissions-Policy` that keeps the microphone for Lepaq itself; `poweredByHeader: false` | This PR |
| MISS-3 | `setAll` drops the no-store headers `@supabase/ssr` sends with a refreshed cookie | Forwarded | This PR |
| SEO-5 | No structured data | WebSite and Organization JSON-LD on `/`, only when the site URL is known | This PR |
| SEO-6 | No theme colour | `#f7f5f1` in the landing page's viewport | This PR |
| CFG-1 | create-next-app leftovers in `public/` | Deleted | This PR |
| SEC-2 | No Content-Security-Policy | Decision D6 | Decide |
| MISS-4 | Unknown URLs send signed-out visitors to sign-in, not a 404 | Decision D7 | Decide |

### 4.3 Everyone can read the story

| ID | What is wrong | Fix | Status |
|---|---|---|---|
| A11Y-1, ROB-1, ROB-M2 | Below 1024 px wide and under 30rem tall (landscape phones, 150-200% zoom on laptops) the header plus stage cover the screen: no chapter is ever readable, and rail links land a chapter early | In that range the stage scrolls with the page instead of pinning; the reading line is clamped to the screen | This PR |
| A11Y-3 | Focus rings are box-shadows at about 2:1 and vanish in forced colours | Solid 2px outlines in `--ring` (3.46:1 on the page) | This PR |
| A11Y-2 | Below 1024 px some focused links sit under the stage or header | `scroll-padding-top` for the header on the landing page, `scroll-margin` for links in chapters | This PR |
| A11Y-4 | The hidden "Scroll to follow" cue can still take focus | Hidden from the tab order while it is faded out | This PR |
| A11Y-5 | Header links drop to 3.28:1 over the dark band | Header background 95% opaque | This PR |
| A11Y-6, ROB-9 | Large default text: rail labels collide | Labels wrap; breakpoints in rem give large text the narrow layout (REV-5); phones with large text in section 4.7 | This PR |
| A11Y-7 | With JavaScript off, chapter text prints over the stage on desktop | The stage only pins once the story script has run, at every width (on a phone it would otherwise hold a frozen picture over half the screen) | This PR |
| A11Y-8, PERF-2 | Three decorative animations loop forever, and the hidden live dot keeps the main thread busy | The dot and cue only run while the opening shows, and stop within 5 s | This PR |
| A11Y-9 | Forced colours: the unticked box shows a tick, nothing marks the current chapter, chart bars vanish | A `forced-colors` block | This PR |
| A11Y-12, ROB-3, PERF-M1 | Reveal can hide content for good (tall blocks at 400% zoom never reach the threshold), hides already-visible content at hydration, and prints blank | Arm only what starts off screen, threshold 0, and a print override | This PR |
| A11Y-14 | The phone rail's bars are 1.3-2.6:1 | Darker bars, with done and current told apart by more than hue | This PR |
| A11Y-16 | Chapter 4's spoken text leaves out the facts; new-tab links do not say so | Fixed | This PR |
| ROB-2 | At laptop heights (1280x593) and large fonts the stage cuts off the Approve button | Container-height tiers per layout, extended in review (REV-4) and again for a band of heights that left (REV-17) | This PR |
| ROB-5 | A flight started before a width change lands in the wrong place | Flights finish on a width change or a font swap; a source still fading in is not flown | This PR |
| ROB-8 | With reduced motion, scene changes show a blank stage for a moment | Scene delays dropped under reduced motion | This PR |
| ROB-10 | Desktop: "How it works" lands chapter 1 under the header | `scroll-margin-top` on the first chapter | This PR |
| ROB-M1 | Chrome Translate, then scrolling back up, crashes the whole page | The illustration is marked `translate="no"`, changing text sits in its own elements, and an error boundary keeps the rest of the page if the story fails | This PR |
| ROB-M3 | At 200% text on phones the header pushes the page sideways | The header row can shrink | This PR |
| CC-18 | On short phone stages the "Sample" tag disappears in chapters 2 and 3 | The tag stays, on the slip's top edge (REV-6) | This PR |
| CC-19 | The non-breaking hyphen in "follow-up" falls back to another font | A no-wrap span instead | This PR |
| A11Y-M1 | After a rail link, the next Tab skips to the benchmark | Needs a design call: a small "Next chapter" link per chapter | Later |
| ROB-4 | Rotating a tablet can change the chapter shown | Restore the chapter after a width change; needs a real iPad to tune | Later |
| ROB-6 | Paging with Space on phones skips half the lines | Dynamic scroll padding while the stage is pinned; needs Safari testing | Later |
| ROB-7 | Android's wide fallback serif clips the quote during font swap | A size-adjusted local fallback face | Later |
| A11Y-11 | With WCAG text-spacing overrides the pinned stage clips | Accepted: every fact on the stage is also in the chapter text | Accepted |

### 4.4 Light on phones

| ID | What is wrong | Fix | Status |
|---|---|---|---|
| PERF-4 | The toast library ships on `/`, which never shows a toast (9.5 KB gzip) | `<Toaster>` moves to the app, sign-in and walkthrough layouts | This PR |
| PERF-5 | The story ships the Tailwind class-merge engine for plain joins (10 KB gzip) | `cn/lite` in the story | This PR |
| PERF-7 | The logo link prefetches `/` on every load | `prefetch={false}` | This PR |
| PERF-M2 | `/demo` renders on every request for a recording-only flag, so the walkthrough link never comes from the CDN | Header and footer walkthrough links stop prefetching here; moving capture mode to its own route is D9 | This PR, D9 |
| PERF-3 | Flight starts force layout (about one frame) | Batch reads before writes | Later |
| PERF-6 | `content-visibility` on lower sections | Gain is small and estimates are tricky | Skipped |
| PERF-M3 | No field Web Vitals | Decision D8 | Decide |

### 4.5 The doors out of the page

| ID | What is wrong | Fix | Status |
|---|---|---|---|
| SEC-3 | `/login?next=https://...` or `next=/%09/evil.example` lands off-site after sign-in | Only same-origin paths are followed, checked by origin rather than by string, and never one starting `//` (REV-1) | This PR |
| MISS-1 | `OWNER_EMAIL` is printed into the static `/login` HTML when set on Vercel | Only passed when the dev sign-in is on (never in production) | This PR |

### 4.6 Found in review of this PR

| ID | What was wrong | Fix | Status |
|---|---|---|---|
| REV-1 | The SEC-3 fix could be bypassed: `next=/.//evil.example` (or `/..//`, `/%2e//`, `https://<domain>//evil.example`) parses to this origin with the path `//evil.example`, which the router reads as another host | `lib/safe-next.ts` also refuses a path starting `//`; the proxy never sends one. 14 cases in `check:landing` | This PR |
| REV-2 | The walkthrough still waited on Supabase: `/demo` and its iframe each ran the session check, about 51 s with an expired cookie and a slow project | The matcher skips `/demo`, `/demo/frame` and their prefetch forms; `/demonstration` still runs it | This PR |
| REV-3 | Every shared summary at `/s/...` unfurled with the landing page's image, a made-up approved follow-up "with Jamie Tan" | The share page sets its own Open Graph tags and a plain summary card | This PR |
| REV-4 | ROB-2 was not finished: 1280x593 with Large text, 125% zoom (1024x474), 1024x768 with Very large text and 2560x1300 at 200% still cut off the Approve button | The 27rem tier applies on desktop too, with a smaller key line; breakpoints and the page width are in rem; the key line takes the full width once its speaker column is hidden; a stage under 20rem wide drops the follow-up count | This PR |
| REV-5 | Large default text on desktop: the wrapped rail labels ran into the transcript, and the opening line into the rail | Breakpoints in rem: 200% text gets the layout a window half as wide gets. At short desktop heights the opening line starts lower | This PR |
| REV-6 | The corner "Sample" tag (CC-18) covered the follow-up's title on small stages | It sits on the slip's top edge | This PR |
| REV-7 | Back after any #link (rail, header, cue) and then a page change left the other page on screen: Next ignores history entries it did not make | `components/landing/fragment-history.tsx` gives each #entry the router's state | This PR |
| REV-8 | The approved report still said "2 facts to review" | "2 facts saved" once approved | This PR |
| REV-9 | CC-4 went half way: "5 of 7" was the best of both modes, and Lepaq records in room mode, where SASRBench is 17.1% and v3 wins 4 sets | See CC-4 | This PR |
| REV-10 | The README said the page notes that speaker labels are not benchmarked; it did not | The benchmark footnote says so | This PR |
| REV-11 | `check:pages` could not tell whether D1 works, and the person page dropped its query error | `check:pages` looks for an approved follow-up's title on another attendee's page; the page logs the error and falls back to the person's own follow-ups | This PR |
| REV-12 | `check:landing` had gaps: JavaScript off could not see a pinned stage, PROXY-1 had no control, ROB-2, A11Y-6 and A11Y-2 were tagged but not measured, the broken-story run never confirmed the story broke, and `--base` without `--` was dropped by npm | Each is measured now (section 7) | This PR |

### 4.7 Found by the last size sweep

Four of the five come from large default text on a phone, where the screen is
very narrow in rem: a 390px phone at 175% text is 14rem wide, where a 1024px
laptop at default text is 64rem. The fifth, LT-5, is on laptops.

| ID | What was wrong | Fix | Status |
|---|---|---|---|
| LT-1 | At 175% text on phones up to 375px wide, and at 200% on any phone, the opening line ran off the right edge: its 2.2rem floor outgrew the column | The floor never outgrows the column | This PR |
| LT-2 | From about 160% text the Open Lepaq button covered the wordmark | Below 15.5rem the header keeps the cup and drops the word (the link is still "Lepaq, home"); below 11.5rem its margins narrow too | This PR |
| LT-3 | At 150% to 175% text "Send the proposal" ran out of the report's card (chapters 2 and 3) and was cut to "Send t…" on Jamie's page (chapter 4), where the "Sample" tag also covered her name | The titles shrink to fit their card, still on one line for the flights; on Jamie's page the date moves under the title and the tag onto the card's top edge | This PR |
| LT-4 | At 200% text on phones 360px wide or less, "remembered." and "follow-up." pushed the page sideways | The opening heading sizes itself to the screen, "follow-up." can break at its hyphen when it cannot fit a line of its own, and any display word too long for a line breaks instead | This PR |
| LT-5 | On laptops from 1024 to about 1150px wide at default text (which takes in 1280 and 1536 wide screens at 125% or 150% zoom), and on wider ones with large text (1280x593 and 1366x768 at Large, 1536x864 at Very large), "Send the proposal" was cut short with an ellipsis on Jamie's page (chapter 4) | Whenever that card is under 15.5rem wide, the date moves under the title, as on phones | This PR |

### 4.8 Found by a second review

From the second review (section 2), except REV-18, which came from testing
its fixes with classic scrollbars, and REV-22, which a skeptic found. The
checks reviewer's first finding, the
"Sample" tag over Jamie's name on phones with large text, had already been
fixed by LT-3: that review ran against the build before section 4.7.

| ID | What was wrong | Fix | Status |
|---|---|---|---|
| REV-13 | Back from the walkthrough stayed on `/demo`. As the film plays, its frame moves its own `#` to light up the line being spoken, and each move added an entry to the tab's history, so from 0:32 the first two Backs only changed the hidden frame. Older than this PR, but the page links to `/demo` three times | The frame replaces its entry instead of adding one (`components/demo/frame.tsx`); the highlight works as before | This PR |
| REV-14 | After a reload of the sign-in page, Back to a `#chapter` opened the landing page at the top. Next draws the page again only after the browser has restored the scroll against the shorter sign-in page; not caused by this PR, and its skeptic did not count it as a defect | When the page comes back at the top with a `#chapter` in the address, FragmentHistory goes to that chapter | This PR |
| REV-15 | REV-5 traded one overprint for another: on short desktops (a stage of about 24 to 27.5rem, as at 1024x487, 1280x593 with Large text and 1920x480) the opening's top rule ran through the quote's attribution, and on wide short windows the headline printed over it | Below about 27.7rem the quote also sizes itself by the stage's height, leaving the opening its room; on a desktop screen 36rem tall or less the headline keeps to one line, with the cue under it and the lede beside both | This PR |
| REV-16 | A branch the first round of fixes added to the smallest stages' tier hid chapter 1's speaker label on phone stages 16 to 20rem wide and 22 to 24rem tall (412x915 and 430x932 with Very large text), where it fitted, so nothing on the stage showed the voices being told apart | Only stages under 17rem wide take that branch (its skeptic found 16rem left the button a pixel short at 320x761 with Large text); the tight check requires the label at 412x915 with Very large text and the button at 320x761 | This PR |
| REV-17 | REV-4 left a band: desktop stages from 27rem to about 28.2rem tall (1024x497 to 1024x508, 1280x621 with Large text, 1536x750 with Very large) still cut off up to a third of the Approve button | The desktop's tighter key line (smaller, with less padding) starts at a 29rem stage instead of 27rem; two sizes in the band, and one just above the new edge, joined the tight check | This PR |
| REV-18 | The words a flight lands in could break over two lines, so the flying copy landed at about twice their size. With a classic scrollbar at 1024px the key line pushed "can?" onto a second line, which also cut the Approve button on stages up to 29rem; on narrow phones the phrases broke, and at 200% text so did Jamie's name. The chapter kicker broke inside "04 / 04" | The key line sizes itself to its column, each phrase and the name stay whole (under 13rem wide, Jamie's avatar gives the name its room), and the kicker wraps between its parts. The tight check flags flight words broken over lines, and runs its desktop sizes again with classic scrollbars | This PR |
| REV-19 | `check:pages` ignored a failed attendee lookup, so D1's check printed "skip" and the run passed | The lookup's error fails the check, and a skipped check is named in the last line | This PR |
| REV-20 | `check:landing --only=keyboard` (or a bare `--only`, or `--only=tight, back` split by the shell) ran nothing and said "All passed" | Unknown options and parts stop the run with the valid names; the browser only starts for a part that needs it | This PR |
| REV-21 | The phone focus check (A11Y-2) tested the middle of the focused link's box, which for a link that wraps is the paragraph between its two lines. Its skeptic found it right today, since the check's phone keeps the link on one line, but at 360x640 it reports "under p" | It tests each line of the link | This PR |
| REV-22 | Since the breakpoints moved to rem, two tight sizes (1280x720 with Very large text, 1440x900 at 200% text) are screens where the stage scrolls with the page, where the stage checks skip, so they passed without checking it | Each tight size says whether its stage pins, and fails if it does not do what it says; 1280x800 with Very large text joins as a pinned laptop. One check now measures every "Sample" tag against all the words in its scene, not one named line each | This PR |

### 4.9 Found by a third review

From the third review (section 2). REV-23 is one defect that both reviewers
found, the layout reviewer on the page and the checks reviewer in the check
that missed it. REV-23 to REV-25 were there before the second review (REV-15
had only moved REV-23 from the first screen into the first scroll); REV-26
to REV-28 came from the second review's own changes.

| ID | What was wrong | Fix | Status |
|---|---|---|---|
| REV-23 | On short desktop windows (1024x487, which is 1536x730 at 150% zoom; 1280x593 at default and Large text; 1920x480; 2560x1300 at 200% text), the opening's rule and then its headline crossed the quote's attribution and recording strip a little way into the first scroll (16 to 56px on most, a press or two of the down arrow), because chapter one takes over only 0.15 of the window's height later. The tight check measured the opening only where a visit starts, so it passed | The opening's card is a sheet in the page's own colour: as it rises it slides over the line's foot instead of printing across it, and at rest it covers nothing. The tight check walks down through the opening in 4px steps on every desktop size until chapter one takes over, counting only the line's ink the sheet leaves in view | This PR |
| REV-24 | Stages 30 to 36rem wide (a window a third of a 1080p screen with Large text, or that window at 125% zoom) carry the report's three ruled rows while the line still sits above the speakers. Just above the 27rem tier, and again just above the phone layout's 33rem tier, the slip was taller than the stage and Approve was cut off by up to 9px | In that band the report's title goes from 28.25rem and the evidence line from just under the 34rem cap. Three sizes in it joined the tight check | This PR |
| REV-25 | The closing picture of the app's Follow-ups page kept "Due in 2 days" beside the follow-up on one row, so on phones at 150% text and up it printed over "Send", and at 200% it ran out of the window and was clipped | Below a 14.5rem window the date goes under the follow-up, below 10.5rem the margins tighten, and below 8.5rem the tick box goes. The tight check measures the picture at every size: no words over others, none out of their card or the window | This PR |
| REV-26 | REV-14's scroll also ran on this page's own reload: a reader who had used a `#link` (the cue, the rail, "How it works", "Privacy"), gone back to the top and reloaded (F5, or pulling down on a phone, which only works at the top) was thrown to that section | It runs only when the router draws this page into a document loaded elsewhere, as after a reload of the sign-in page, never on a load of the page itself. The Back check adds a reload at the top | This PR |
| REV-27 | The flight-words check (REV-18) counted lines with `getClientRects()`, which gives one box for a flex or grid item however many lines its text takes, so it could not see a break in five of the 14 boxes a flight lands in: all three of chapter 2's, and the title and date on Jamie's page. Nothing breaks on this build | It counts the text's own line boxes. CSS that lets either follow-up title wrap, which the old count missed, is caught at every phone size tried where it breaks | This PR |
| REV-28 | The docs said the Back check presses Back out of the walkthrough once its film has moved the frame's `#`. It only called the frame's own code in a tab of its own and counted history entries, so a player that added entries some other way would pass | It does what the docs say: the footer's link to `/demo`, the film skipped ahead with its own arrow key into the evidence scene and out of it, then one Back, which must land on this page | This PR |

### 4.10 Found by a fourth review

From the fourth review (section 2), of what the third review changed.
REV-29 is older than this review: the history reviewer found it and left it
out as such, and it is fixed anyway. REV-30 to REV-32 came from the third
review's own changes.

| ID | What was wrong | Fix | Status |
|---|---|---|---|
| REV-29 | On this page the header's logo ("Lepaq, home") was a Link to `/`, the page itself: clicked far down the page it only took the `#` off the address and left the reader where they were | It goes to the top of this page, as "Read the story again" does (`#top`). The Back check clicks it from chapter 4 and wants the top, then Back to chapter 4 | This PR |
| REV-30 | REV-24's rule for stages 30 to 36rem wide hid every evidence line on the stage, so in chapter 4 Jamie's page lost the line saying which meeting the follow-up came from, where it fitted with 45 to 75px to spare (at the default text size, windows about 480 to 575px wide and 913 to 936px tall, 495 to 590px with classic scrollbars; at Large text, 600 to 719 by 1140 to 1170) | The rule hides only the report's evidence line. At 575x914 the tight check wants Jamie's line shown | This PR |
| REV-31 | The tight check's wait for the closing picture's animations had no time limit, so a looping one (a pulsing due date, say) would hold the whole run with no FAIL line, and so would a scroll-driven one that rests part way, on a page with nothing wrong | It waits only for the picture's timed animations, for at most 5s, and names any still running then. A pulsing due date is now reported in 5s; a scroll-driven drift passes | This PR |
| REV-32 | The opening's sheet counted as opaque from the card's own opacity and background alone, so a fade put on its list item or on the chapters' list, or an opacity filter, would let the line show through and still pass | It counts as a sheet only with no opacity or opacity filter on the card or anything above it, and no blend mode from the chapters' list up. Those are now caught at 1024x487 and 1280x593, while a drop shadow or a blend on the card, which leave the line hidden, still pass | This PR |

## 5. Decisions

**D1 (P). Make Jamie's page show the follow-up, or change the story?** The app
files a follow-up under its owner, so a follow-up you owe Jamie lands on your
list and Harbour Studio's page, not Jamie's. Recommended, and done in this PR:
Jamie's page lists open follow-ups that are hers or from meetings she was in,
which is what the company page already does for its meetings. One more query;
in a group meeting every attendee's page shows that meeting's follow-ups.
`npm run check:pages` now looks for an approved follow-up on the page of
someone else from its meeting; run it against real data before merging. If P prefers the other
way, chapter 4, the lede, the meta description, the finale and the line on the
preview image change instead.

**D2 (team). Keep unapproved emotion reads and coaching off the person page and
dashboard.** The page no longer claims it, but the README's "private draft"
stance does. Fix: in `people/[id]/page.tsx` select reads with
`meetings!inner(id, title, meeting_date, status)` and
`.eq("meetings.status", "ready")`, take coaching from the newest `ready`
meeting, and filter `meetingIds` to `ready` before the dashboard's reads query.

**D3 (team). Stop storing voiceprints until there is a consent flow.** Every
meeting writes per-speaker embeddings (`finishTranscription.ts:73-86`); nothing
reads them, and migration 0004 itself calls them biometric data. Gate the
insert behind `STORE_VOICE_EMBEDDINGS` (default off), or at least delete them
with the audio. If they stay, the privacy section must say so.

**D4 (team). Deleting a meeting should delete its recording and its fact
drafts.** Today it is a browser-side row delete. Add
`DELETE /api/meetings/[id]` that removes the audio object if still there,
deletes unapproved `person_facts` for the meeting, then the meeting, and say
"and the recording" in the dialog.

**D5 (owner and counsel). Privacy notice and terms.** Sign-up is open and the
product sells privacy. Add static `/privacy` and `/terms` with reviewed text
(processors: Modal for audio, Anthropic for transcripts, Supabase, Vercel),
make them public in `proxy.ts`, and link them from the footer and the sign-up
form. Needed before inviting the public to sign up.

**D6 (team). Content-Security-Policy.** Roll out one site-wide policy as
`Content-Security-Policy-Report-Only` first; never one for `/` alone (a policy
survives soft navigation and would break sign-in). Starting point:
`script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://<ref>.supabase.co; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'`.

**D7 (team). Show a 404 for unknown URLs.** Redirect signed-out visitors to
sign-in only for the app's own prefixes, and let `/api/*` answer 401 itself.

**D8 (team). Field Web Vitals.** Vercel Speed Insights or `useReportWebVitals`,
and a line in the privacy notes, since the footer says the story saves nothing.

**D9 (team). Make `/demo` static.** Move `?capture=1` to its own route and
point `scripts/record-demo.ts` at it.

**Signed-in visitors on `/`.** With the proxy off `/`, the landing page cannot
redirect signed-in users to `/dashboard` without putting Supabase back in front
of it. Recommended: keep `/` static for everyone; "Open Lepaq" takes them in.

**Small app fixes found on the way** (not landing scope): `dueLabel` says "Due
in 1 days" (`lib/utils.ts`), the approve bar says "1 follow-ups"
(`meeting-detail.tsx:488`), and the proxy could answer 503 at once when
`getUser()` returns a retryable fetch error instead of waiting for its retries.

## 6. Release checklist

1. P answers D1; the team runs `npm run check:pages` on real data for the person page.
2. Vercel, Production: set `NEXT_PUBLIC_APP_URL` to the real `https://` domain,
   then redeploy (it is read at build time).
3. Vercel, Production and Preview: remove `OWNER_EMAIL`, `OWNER_USER_ID` and
   `DEV_AUTH_BYPASS`; they are for local work and scripts only.
4. Confirm the transcription region (the page says Modal, US East, from the
   owner's 28 Oct review) and run `npm run preflight` against production to
   confirm the WhisperLah URL, token and `model_version`.
5. Decide D3 before launch, or add the voiceprint line to the privacy section.
6. After the deploy:
   - `npm run check:landing -- --base=https://<domain>`
   - `curl -sI https://<domain>/robots.txt` and `/sitemap.xml` answer 200
   - `curl -s https://<domain>/login | grep -o 'devEmail[^,}]*'` shows `null`
   - paste the URL into LinkedIn's Post Inspector and a WhatsApp chat to see the card
7. On real devices: iPhone Safari upright and sideways, Android Chrome with
   Translate on, an iPad, and a Windows laptop at 150% scaling and at 200% zoom.
8. D5 before sign-up is promoted.

## 7. How it is checked

- `npm run check:landing` (new, `scripts/check-landing.ts`) drives a headless
  Chrome or Edge through a running build, 102 checks in all:
  - over HTTP: the preview card tags and image, canonical, theme colour,
    structured data, robots.txt and sitemap.xml answering without a sign-in
    redirect, `/`, `/demo` and `/demo/frame` answering in milliseconds with an
    expired session cookie (and a control: the same cookie does slow down
    `/login`, or the run warns that it was not this deployment's), the
    security headers, `noindex` and a plain preview card on `/s/`, and the app
    still behind sign-in;
  - 14 sign-in `?next=` cases, the REV-1 bypasses among them;
  - every chapter link, and a page opened on `#chapter-approved`, landing on
    the right step with its words in view, at 1440x900, 1280x593, 768x1024,
    390x844, 320x568, 844x390 and 640x296, and at 200% text on a laptop and a
    phone, with no sideways scroll;
  - at 26 short, narrow or large-text sizes, from a 320x568 phone at 200% text
    to 2560x1300 at 200%, and the 17 desktop ones again with classic
    scrollbars: the stage pinned where it should be and scrolling with the
    page where it should not (REV-22); the Approve button and the open
    follow-up inside the pinned stage, three of the sizes in the band of
    tablet-width stages (REV-24); no rail text, rail bar or "Sample" tag over
    the stage's words; the opening's words and rule clear of the spoken line,
    measured by their ink where a visit starts and at every 4px of scroll
    until chapter one takes over, where only the line's ink in view counts
    (REV-23), and the card counts as a sheet only with nothing translucent on
    it or above it (REV-32); no stage text cut off or running out of its card,
    the follow-up's title whole, and the words a flight lands in on one line,
    counted by the text's own lines (REV-27); chapter 1 still naming the
    speakers at 412x915 with Very large text, and Jamie's page still naming
    the meeting at 575x914 (REV-30); the header's logo clear of Open Lepaq;
    the closing picture of the app with no words over others or out of their
    card or the window (REV-25), the wait for its timed animations ending
    after 5s (REV-31); and no sideways scroll;
  - Back from sign-in after a chapter link, also with a reload of the sign-in
    page in between; a reload at the top after a chapter link staying at the
    top (REV-26); Back and Forward between chapters; the header's logo,
    clicked from chapter 4, going to the top, and Back to chapter 4 (REV-29);
    and from the footer's link to the walkthrough, its film skipped with its
    own arrow key into the evidence scene and out, one Back to this page
    (REV-28);
  - focus outlines on the first 16 tab stops, the faded opening's link out of
    the tab order, and a focused chapter link on a phone clear of the stage;
  - a simulated Translate that leaves `translate="no"` alone, scrolling down,
    back up and down again;
  - reduced motion: the stage changes at once, never blank, nothing flying;
  - scroll-in content: printed before it arrives, arriving at 200% text, and
    never hidden when it is already on screen;
  - with JavaScript off, and with the story's script made to fail (and proof
    that it did fail), every chapter readable and the stage no longer pinned
    or sharing the screen with it.
- On this branch all 102 pass (production build, `NEXT_PUBLIC_APP_URL` set).
  An unknown option or part (`--only=keyboard`) stops the run instead of
  passing it (REV-20). The first version of the script, 47 checks, failed 27
  of the 45 it could run against the build before this PR (with no site
  address, two only warn). Of the checks added after review, the stage, rail
  and "Sample" tag checks were run on this branch before their fixes or with
  the old CSS put back, and failed there; the others follow the reviewers'
  reproductions. The stage checks failed at 11 of the 18 sizes of the time on
  the build before section 4.7, and 33 of the third review's 101 fail on the
  build before sections 4.7 to 4.9. The fourth review's checks for REV-29 and
  REV-30 failed on the build before their fixes.
- A wider sweep with the same stage probes, 102 window and text sizes from
  260x562 to 2560x1440 and from 16px to 32px text, with and without classic
  scrollbars, is clean, the opening walked through its first scroll and the
  closing picture measured at each. Room under the Approve button on short
  desktops, measured at 170 window and text sizes (stages 22rem to 44rem tall
  at 12px to 24px text, closely spaced from 27rem to 30rem, where the layout's
  tiers change), is at least 6px with 12px text and 10px with the default
  16px, with or without them.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`.
- The manual device pass in section 6.

## 8. Not doing

Refuted on review: the claim that production serves an older model (CC-5: the
served model is v3, within a point of the eval), muted stage text contrast (A11Y-10: inactive
UI in an illustration), focus moving to `<body>` after a fragment link (A11Y-13:
standard behaviour), table roles at 390 px (A11Y-15: kept in Chromium), and an
error path in the flight code (ROB-11: needs `cacheComponents`, which is off).

Refuted in the review of this PR: that "filed with the person who asked" is
false (it is D1, P's call), the stage's "With" label, "17 other models" (the
results table's own wording, and now gone with "5 of 7"), the share-link
copy leaving out the title and date (the Share dialog lists them first),
coaching on the person page (the card's claim is about facts), the person
page's query growing with meetings (the dashboard's already does, and would
fail first), a PROXY-1 cookie mismatch in the documented local run (the
control in REV-12 covers a deploy), printing from mid-story (older than this
PR, and printing the page is not in scope), chapters landing one step early at
400% zoom on short laptops (only a 6px dot is wrong; the text lands), and
`.step a` scroll margins in Firefox 111-120 (not reproducible here).

In the second review, REV-14 and REV-21 were judged not to be defects today;
both are hardened anyway (section 4.8).

Seen in the fourth review and left as they are: on desktop stages under about
20rem tall (a 1920x370 window, or 1920x480 with 24px text) the opening's card
covers the foot of the spoken line where a visit starts, where before the
third review its headline printed over it (narrower windows that short get a
stage that scrolls with the page; a desktop's stays pinned); Back to this page
after a chapter link lands on that chapter even when the reader had scrolled
on before leaving; just above the closing picture's 14.5rem and 10.5rem tiers
the follow-up runs one word to a line, or the date takes two lines, cramped
but whole; and the probe no longer flags a recording strip within 2px above
the opening's rule where a visit starts (the gap is 15 to 46px at every size
measured).
