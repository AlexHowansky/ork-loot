## Phat Loot Specification

What the app does: its terms and its features. How it is built is in
`CLAUDE.md`.

## Terms

We define the following terms:

### GM

An authenticated app user with elevated permissions.

### Character

A virtual character in a game world. A character belongs to one campaign.

### Player

An app user invited by a code. The code ties the user to one character.

### Campaign

A campaign belongs to one GM and has zero or more sessions. Campaigns have
names, start dates, optional background images, and zero or more characters.

### Petty Cash

A per-campaign amount, in the campaign's currency, that holds what was left
over when the last split couldn't be divided evenly. The next split pays it
out along with the loot, so it never builds up past one unit per share. It
isn't edited by hand. The GM and players see it next to the party fund.

### Debt

What a character still owes because their claims were worth more than
their share in an earlier split. Only campaigns that allow debt carry it.
The next splits take it off the character's payout until it is repaid. It
isn't edited by hand.

### Session

A single instance of game play, typically a few hours long. A session belongs to
a campaign and has a date.

### Loot Pool

The pile of loot thus far accumulated for a campaign. Items will be frequently
added (acquired through gameplay) and removed (claimed by a player or sold.)

### Loot Split

The pile of loot is sold and the proceeds are split amongst the characters.

## Features

We are building an app to track loot in table-top role playing games. We'll
allow the GM to establish what loot has become available, and we'll allow the
players to claim or sell the loot. The app will track the value of the loot,
the size of the share that each player gets when selling based on what items
they have claimed from the pool.

* GMs are created by a CLI tool. GMs login with a userid and password. 

* GMs can view, create, edit, and delete their own campaigns.

* Each campaign sets its currency: a label (e.g. "gp") and 0 to 3 decimal
  places. The decimal places are locked once the campaign has any loot or
  any petty cash.

* The campaign form has a game system selector, a shortcut that fills in the
  currency label, decimal places and base reference URL; the choice itself
  isn't stored, and it shows "Custom" when the fields match no system.
  Pathfinder 2E Remaster is gp, 2 places, https://2e.aonprd.com/; Starfinder
  2E is cr, 1 place, https://2e.aonsrd.com/. Once decimal places are locked,
  systems that use different decimal places can't be picked.

* Each campaign has an "Allow debt" checkbox, off by default. When it's
  off, a split can't run while any character's payout would be negative;
  the split preview says who and why. When it's on, a negative payout
  becomes that character's debt. Debt can't be turned off while any
  character owes.

* Each campaign may set a base reference URL (an http or https address, e.g.
  a rules reference site). The loot form searches it for items (see below).

* A campaign's background image is uploaded to local disk (PNG, JPEG or WebP,
  up to 5 MB, checked by content rather than by the type the browser claims).
  The GM's campaign list and the player's character picker show it cropped
  to a square at the top of each card.

* GMs can add zero or more characters to a campaign. Each character has a name
  (required, unique within the campaign regardless of case) and a number of
  shares (required, a whole number from 0 to 100, default 1.) A character
  with 0 shares sits splits out, e.g. one who has left the party or missed
  the sessions being split, and can't claim loot. Setting a character's
  shares to 0 releases their claims back to the pool, after the GM is
  warned how many will go. Characters
  get a default join code which can be given to players. Once used, the code is
  invalidated. If the player misplaces the code, the GM can create a new one.
  Creating a new code signs out the character's current player at once;
  whoever redeems the new code takes the character over.

* A character who has taken part in a loot split can't be deleted, so split
  history stays intact. Deleting any other character returns their claims to
  the pool.

* Players can provide a code to take ownership of one character in one campaign.
  This session does not expire. One browser can hold several characters, with
  a picker to switch between them, and can choose to forget a character. The
  picker shows a card per character, with its campaign's image.

* Players see the whole campaign: every loot item, every character's shares
  and projected payout, and the split history. Join codes are GM-only.

* Every browser showing a campaign, the GM's and players' alike, updates
  within moments when anything in it changes (loot, claims, splits,
  characters, sessions), without reloading the page.

* The campaign page, for the GM and players alike, shows its contents in tabs
  in this order: "Loot", "Sessions", "Characters" and "Splits". Loot is shown
  first.

* The GM can view, create, edit, and delete sessions in their campaigns.

* The GM can view, create, edit, and delete loot in a session. Each loot entry
  includes session (required), name (required, not unique), description
  (optional), link (optional, http or https only), quantity (required,
  default 1), value (optional), market percentage (default 50% because we
  only get half value when we sell) and status.

* A loot item can be marked unidentified (off by default), from a checkbox
  to the right of the loot form's name. Until the GM clears it:
    * Players see the item's name, but not its description, link (whose
      page could give its price) or value; the server never sends them
      those. The loot table marks it with an "Unidentified" badge.
    * Players can't claim it. The GM can claim it for a character, and a
      claimed part of a stack stays unidentified.
    * Its value counts as zero everywhere: the pool, party fund, claims,
      projected payouts and the loot table's total.
    * A split leaves it as it is, available or claimed, so it can be sold
      at its real value once identified.

* When the campaign's base reference URL is a site the app knows how to
  search (for now the Archives of Nethys at https://2e.aonprd.com/ and
  https://2e.aonsrd.com/), the loot form's link field suggests up to 10
  items from that site matching the item's name. Choosing one fills in the
  link, and the value too when the site gives a price that converts exactly
  into the campaign's currency (gp for Pathfinder, cr for Starfinder). The
  server makes the search itself and contacts only those known sites; other
  base reference URLs get no suggestions.

* When a loot item has a link, its name in the loot table links to it, in a
  new tab, for the GM and players alike.

* The loot table shows each item's status as a pill on its own, and the
  character who claimed or bought it in a separate "Claim" column.
  Each pill has an icon: a tag for available, a group of people for party, a
  hand for claimed, a person for bought, a sack of money for sold and a trash
  can for abandoned. Hovering over a status pill shows what that status
  means, as described below.

* When the loot table shows all sessions, a "Session" column after "Claim"
  shows the session's date. Hovering over the date shows that session's title
  and notes.

* The loot table is sorted by item name, A to Z.

* The loot table filters by session and by status: "Pool" (available, party
  and claimed), "Available" (not yet claimed), "Gone" (sold, bought and
  abandoned) and "All".

* A search box beside the loot table's filters narrows it to items whose
  name contains the text typed, ignoring case and accents. It works together
  with the session and status filters, and Escape clears it. Following a
  session's link to its loot clears the search.

* Item statuses are as follows:
    * Available: This item is in the current loot pool, is free to be claimed,
                 and will be sold during the next split. This is the default for
                 new items.
    * Claimed: This item is in the current loot pool and has been claimed by a
               character. Its market value will be deducted from the claiming
               player's next split.
    * Party: This item has been set aside into a party fund, can not be claimed,
             and will not be sold during the next split. This is useful for
             shared items or emergency use items.
    * Sold: This item went unclaimed and was sold during a prior split. It is
            listed here for historical purposes only.
    * Bought: This item was claimed and had its value accounted for during a
              prior split. It is listed here for historical purposes only.
    * Abandoned: This item was discarded or never picked up. It is listed here
                 for informational purposes only.

* Each loot row should calculate a subtotal of quantity times value, further
  adjusted for market percentage.

* For each campaign, keep a running total of the value of the loot pool. Keep
  track of each character's share of the value.

* Allow players to claim pieces of available loot for their character. Claimed
  pieces reduce the character's share accordingly. Once a piece has been
  claimed, it can not be claimed by another character. If a line has more than
  one quantity, ask the player how many they want to claim, and then split as
  appropriate.

* Players can release their own claims back to the pool. A released part of
  a stack merges back into the matching available row from the same session.

* The GM can claim available loot on a character's behalf from the loot table,
  choosing the character and, for a stack, how many, and can release any
  character's claim. These work just as a player's own claims and releases.

* Players can only set status to claimed. This also associates their character
  with the item.

* Only the GM can set statuses besides claimed.

* The GM can, at any time, perform a loot split. This represents selling off
  loot acquired since the last loot split. When a loot split happens:
    * Add the value of all available items plus all claimed items, plus
      the petty cash.
    * Allocate this total across all characters, accounting for the number of
      shares each has. A split needs at least one share among the
      characters. A character with 0 shares takes no part in the split and
      isn't recorded in it.
    * Subtract the value of each player's claimed items, and any debt they
      owe, from their share.
    * Report each player's split value. This is how much they earn from the
      sale. It can be negative when their claims and debt are worth more
      than their share; that is refused unless the campaign allows debt,
      in which case it becomes their debt.
    * Update each claimed item to bought. Update each available item to sold.

* Claimed items are valued at their market-adjusted subtotal, the same figure
  that goes into the total. Every share is worth exactly the same: the total
  divided by the number of shares, rounded down to a whole minor unit. A
  character's share is that amount times their shares, before claims are
  subtracted. Whatever doesn't divide evenly becomes the new Petty Cash, but
  only when the split is run; the split preview shows how much petty cash
  is paid out and how much will be kept, and the split history shows what
  each split divided and kept.

* The board's pool to split and per-share figures, and each character's
  projected payout, include the petty cash. Projected payouts also take off
  each character's debt.

* Debt repaid in a split is only held back from the debtor's payout; it
  isn't divided among the others, who were paid their full share in the
  split where the debt arose. A character with 0 shares keeps their debt
  until a later split they take part in. The characters table shows a
  Debt column, and the split history a "Debt in" column, whenever there
  is any; a player who owes sees their debt on the board.

* The GM sees a preview of the split before running it. Every split is kept
  in a history showing each character's share, claims and payout.

* The GM can undo the most recent split, from a button in its entry in the
  split history, after confirming. Undoing it turns its bought items back
  into claims for the same characters and its sold items back to available,
  puts petty cash and each character's debt back to what they were before
  the split, and removes the split from the history. Older splits can then
  be undone in turn. A bought item whose character now has 0 shares goes
  back to available instead, since that character can't hold a claim.
