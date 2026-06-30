# Manual Test Scenarios

## Scenario: Snap an opponent's 9 after spying and discarding

**Setup:** Two players in a room. The game is in the `playing` state.

**Steps:**
1. Player A draws a `9` on their turn.
2. Player A uses the drawn `9` to spy on Player B and sees that Player B has a `9` in slot `i`.
3. Player A discards the drawn `9` (the Keesh window appears for 5 seconds).
4. Player A clicks Player B's `9` in slot `i` to snap it.

**Expected result:** Player B's slot `i` becomes empty and the `9` goes to the discard pile. Player A gets play focus and must choose one of their own cards to place into Player B's empty slot `i`. After giving the card, Player A's turn ends and the 5-second Keesh window appears.

## Scenario: Wrong snap keeps the target card and adds a penalty slot

**Setup:** Two players in a room. The game is in the `playing` state.

**Steps:**
1. Ensure the top of the discard pile is a `5`.
2. Player A snaps one of Player B's cards that is **not** a `5`.

**Expected result:** Player B's card stays in its slot. Player A receives a penalty card in the first empty slot. If Player A has no empty slots, a new slot (5th, 6th, etc.) is added and the penalty card goes there.

## Scenario: 7/8/9/10 special cards are discarded when used

**Setup:** Two players in a room. The game is in the `playing` state.

**Steps:**
1. Player A draws a `7` (or `8`).
2. Player A clicks the peek button and selects one of their own cards to peek.
3. Player A draws a `9` (or `10`).
4. Player A clicks the spy button and selects one of Player B's cards to spy.

**Expected result:** After each peek/spy action, the drawn special card appears on the discard pile. The Keesh button turns green for 5 seconds. Player A does not keep the special card for a normal swap.

## Scenario: Keesh window is 5 seconds

**Setup:** A game in the `playing` state.

**Steps:**
1. Player A discards a drawn card.
2. Observe the Keesh button next to the discard pile.

**Expected result:** The Keesh button is green and clickable for exactly 5 seconds.
