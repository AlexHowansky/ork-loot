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

A per-campaign amount, in the campaign's currency, that holds what's left over
when a split can't be divided evenly. It accumulates as splits run and isn't
edited by hand. The GM and players see it next to the party fund.

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

* A campaign's background image is uploaded to local disk (PNG, JPEG or WebP,
  up to 5 MB, checked by content rather than by the type the browser claims).
  The GM's campaign list and the player's character picker show it cropped
  to a square at the top of each card.

* GMs can add zero or more characters to a campaign. Each character has a name
  (required, unique within the campaign regardless of case) and a number of
  shares (required, a whole number of at least 1, default 1.) Characters
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

* The GM can view, create, edit, and delete sessions in their campaigns.

* The GM can view, create, edit, and delete loot in a session. Each loot entry
  includes session (required), name (required, not unique), description
  (optional), link (optional, http or https only), quantity (required,
  default 1), value (optional), market percentage (default 50% because we
  only get half value when we sell) and status.

* When a loot item has a link, its name in the loot table links to it, in a
  new tab, for the GM and players alike.

* The loot table shows each item's status as a pill on its own, and the
  character who claimed or bought it in a separate "Claimed by" column.
  Hovering over a status pill shows what that status means, as described
  below.

* When the loot table shows all sessions, hovering over a session's date
  shows that session's title and notes.

* The loot table filters by session and by status: "In pool" (available, party
  and claimed), "Available" (not yet claimed), "Gone" (sold, bought and
  abandoned) and "All".

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
    * Add the value of all available items plus all claimed items.
    * Allocate this total across all characters, accounting for the number of
      shares each has.
    * Subtract the value of each player's claimed items from their share.
    * Report each player's split value. This is how much they earn from the
      sale. It can be negative when their claims are worth more than their
      share.
    * Update each claimed item to bought. Update each available item to sold.

* Claimed items are valued at their market-adjusted subtotal, the same figure
  that goes into the total. Every share is worth exactly the same: the total
  divided by the number of shares, rounded down to a whole minor unit. A
  character's share is that amount times their shares, before claims are
  subtracted. Whatever doesn't divide evenly is added to Petty Cash, but only
  when the split is run; the split preview shows how much that will be, and
  the split history shows how much each split added.

* The GM sees a preview of the split before running it. Every split is kept
  in a history showing each character's share, claims and payout.
