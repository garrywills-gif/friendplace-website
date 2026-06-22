"""Crossword puzzle library — auto-built dense interlocking grids.

The library uses an **auto-generator** that takes a themed list of
(word, clue) pairs and packs them into a real crossword:

  * Words intersect — every placed word shares at least one letter with a
    previously-placed word.
  * Cells before/after each word are blocked, so words can't bleed into
    each other.
  * Empty cells adjacent (perpendicular) to a placed word are blocked,
    so we never create accidental "shadow" words.

The result is a normal-looking crossword with ~8–14 clues across AND
down, just like a newspaper puzzle. The previous "3 acrosses, 1 down"
sparse approach has been retired.

Rotation:
  Players see THREE puzzles per level at any given time. Every 14 days
  the active set rotates. With 8 puzzles per level the same trio comes
  back every ~16 weeks (well past the user's "fresh every 2 weeks" ask).

Points per completion (one-off per (user, puzzle)):
    easy=5, medium=10, hard=15, expert=25
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional


# ────────────────────────────────────────────────────────────────────────────
# Auto crossword generator
# ────────────────────────────────────────────────────────────────────────────
WordClue = tuple[str, str]   # (answer, clue)


def _can_place(grid, word, sr, sc, d, G) -> bool:
    """True if `word` can sit at (sr,sc) going direction `d` without:
      • running off the grid,
      • conflicting with an existing letter,
      • being directly extended (cell before or after is filled),
      • brushing perpendicular letters at any of its empty cells (which
        would silently create a 2-letter "shadow" word).
    """
    L = len(word)
    if d == "A":
        if sc < 0 or sc + L > G:
            return False
        if sc > 0 and grid[sr][sc - 1] is not None:
            return False
        if sc + L < G and grid[sr][sc + L] is not None:
            return False
        for i, ch in enumerate(word):
            r, c = sr, sc + i
            cur = grid[r][c]
            if cur is not None and cur != ch:
                return False
            if cur is None:
                if r > 0 and grid[r - 1][c] is not None:
                    return False
                if r + 1 < G and grid[r + 1][c] is not None:
                    return False
    else:  # D
        if sr < 0 or sr + L > G:
            return False
        if sr > 0 and grid[sr - 1][sc] is not None:
            return False
        if sr + L < G and grid[sr + L][sc] is not None:
            return False
        for i, ch in enumerate(word):
            r, c = sr + i, sc
            cur = grid[r][c]
            if cur is not None and cur != ch:
                return False
            if cur is None:
                if c > 0 and grid[r][c - 1] is not None:
                    return False
                if c + 1 < G and grid[r][c + 1] is not None:
                    return False
    return True


def _score_placement(grid, word, sr, sc, d) -> int:
    """Count letters that intersect existing letters — more = better."""
    n = 0
    for i, ch in enumerate(word):
        r, c = (sr, sc + i) if d == "A" else (sr + i, sc)
        if grid[r][c] == ch:
            n += 1
    return n


def auto_build_crossword(
    puzzle_id: str,
    level: str,
    theme: str,
    words: list[WordClue],
    grid_buffer: int = 31,
    max_size: int = 15,
) -> dict:
    """Pack `words` into a dense interlocking crossword.

    The greedy placement is sensitive to which word seeds the grid. To
    maximise clue density we try the **top 5 longest words** as candidate
    seeds and keep the result with the most placements (ties broken by
    smaller grid size — denser is better).

    Words that simply can't fit are dropped. The minimum acceptable puzzle
    has ≥ 4 placed words; otherwise we raise to surface the bad input.
    """
    if not words:
        raise ValueError(f"{puzzle_id}: no words provided")
    words = sorted([(w.upper(), c) for w, c in words], key=lambda wc: -len(wc[0]))

    best_result: dict | None = None
    best_unconstrained: dict | None = None  # fallback if size cap can't be met
    # Try the top-N longest words as seeds — denser crosswords usually
    # start from the longest available word, but ties are common so try
    # the longest few and pick the best result.
    n_seeds = min(5, len(words))
    for seed_idx in range(n_seeds):
        # First try respecting max_size.
        result = _try_build(puzzle_id, level, theme, words, seed_idx, grid_buffer, max_size)
        if result is not None:
            if best_result is None:
                best_result = result
            else:
                placed_a = len(best_result["clues"]["across"]) + len(best_result["clues"]["down"])
                placed_b = len(result["clues"]["across"]) + len(result["clues"]["down"])
                if placed_b > placed_a:
                    best_result = result
                elif placed_b == placed_a and result["size"] < best_result["size"]:
                    best_result = result
        # Always try an unconstrained build too — used as a fallback if
        # the size cap can't be satisfied for any seed.
        unc = _try_build(puzzle_id, level, theme, words, seed_idx, grid_buffer, grid_buffer)
        if unc is not None:
            if best_unconstrained is None or unc["size"] < best_unconstrained["size"]:
                best_unconstrained = unc

    # Fall back to the smallest unconstrained result if no size-capped
    # result succeeded.
    final = best_result or best_unconstrained
    if final is None or (
        len(final["clues"]["across"]) + len(final["clues"]["down"])
    ) < 4:
        raise ValueError(
            f"{puzzle_id}: only "
            f"{0 if final is None else len(final['clues']['across']) + len(final['clues']['down'])}"
            f" words placed (need ≥4). Try adding more theme words with shared letters."
        )
    return final


def _try_build(
    puzzle_id: str,
    level: str,
    theme: str,
    words: list[WordClue],
    seed_idx: int,
    grid_buffer: int,
    max_size: int,
) -> dict | None:
    """Run one placement attempt starting from `words[seed_idx]`."""
    G = grid_buffer
    grid: list[list[Optional[str]]] = [[None] * G for _ in range(G)]
    placements: list[tuple[str, int, int, str, str]] = []

    seed_word, seed_clue = words[seed_idx]
    if len(seed_word) > max_size:
        return None  # seed too long for the cap
    r0 = G // 2
    sc0 = (G - len(seed_word)) // 2
    for i, ch in enumerate(seed_word):
        grid[r0][sc0 + i] = ch
    placements.append(("A", r0, sc0, seed_word, seed_clue))

    remaining: list[WordClue] = [w for i, w in enumerate(words) if i != seed_idx]
    for _attempt in range(6):
        if not remaining:
            break
        next_remaining: list[WordClue] = []
        progress = False
        for word, clue in remaining:
            best = None  # (score, dir, sr, sc)
            for wi, wch in enumerate(word):
                for r in range(G):
                    for c in range(G):
                        if grid[r][c] != wch:
                            continue
                        # Vertical
                        sr = r - wi
                        if _can_place(grid, word, sr, c, "D", G):
                            s = _score_placement(grid, word, sr, c, "D")
                            if s > 0 and (best is None or s > best[0]):
                                best = (s, "D", sr, c)
                        # Horizontal
                        sc = c - wi
                        if _can_place(grid, word, r, sc, "A", G):
                            s = _score_placement(grid, word, r, sc, "A")
                            if s > 0 and (best is None or s > best[0]):
                                best = (s, "A", r, sc)
            if best:
                _, d, sr, sc = best
                for i, ch in enumerate(word):
                    if d == "A":
                        grid[sr][sc + i] = ch
                    else:
                        grid[sr + i][sc] = ch
                placements.append((d, sr, sc, word, clue))
                progress = True
            else:
                next_remaining.append((word, clue))
        remaining = next_remaining
        if not progress:
            break
    dropped = [w for w, _ in remaining]

    # Trim to bounding box.
    rows = [r for r in range(G) if any(grid[r][c] is not None for c in range(G))]
    cols = [c for c in range(G) if any(grid[r][c] is not None for r in range(G))]
    if not rows or not cols:
        return None
    rmin, rmax = min(rows), max(rows)
    cmin, cmax = min(cols), max(cols)
    h = rmax - rmin + 1
    w = cmax - cmin + 1
    size = max(h, w)
    if size > max_size:
        # This seed produced too large a grid — caller will skip / try another seed.
        return None
    new_grid: list[list[Optional[str]]] = [[None] * size for _ in range(size)]
    rpad = (size - h) // 2
    cpad = (size - w) // 2
    for r in range(rmin, rmax + 1):
        for c in range(cmin, cmax + 1):
            new_grid[r - rmin + rpad][c - cmin + cpad] = grid[r][c]
    adj: list[tuple[str, int, int, str, str]] = [
        (d, sr - rmin + rpad, sc - cmin + cpad, w, cl) for d, sr, sc, w, cl in placements
    ]
    return _finalise(puzzle_id, level, theme, size, new_grid, adj, dropped=dropped)


def _finalise(
    puzzle_id: str,
    level: str,
    theme: str,
    size: int,
    grid: list[list[Optional[str]]],
    placements: list[tuple[str, int, int, str, str]],
    *,
    dropped: list[str] | None = None,
) -> dict:
    # Auto-number cells that start an across or down word.
    numbers: dict[tuple[int, int], int] = {}
    counter = 0
    for r in range(size):
        for c in range(size):
            if grid[r][c] is None:
                continue
            sa = (c == 0 or grid[r][c - 1] is None) and (c + 1 < size and grid[r][c + 1] is not None)
            sd = (r == 0 or grid[r - 1][c] is None) and (r + 1 < size and grid[r + 1][c] is not None)
            if sa or sd:
                counter += 1
                numbers[(r, c)] = counter

    across: list[dict] = []
    down: list[dict] = []
    for d, sr, sc, w, cl in placements:
        if (sr, sc) not in numbers:
            raise ValueError(
                f"{puzzle_id}: word '{w}' at ({sr},{sc}) is not at a word start"
            )
        entry = {
            "num": numbers[(sr, sc)],
            "row": sr,
            "col": sc,
            "len": len(w),
            "clue": cl,
            "answer": w.upper(),
            "dir": d,
        }
        if d == "A":
            across.append(entry)
        else:
            down.append(entry)
    across.sort(key=lambda x: x["num"])
    down.sort(key=lambda x: x["num"])

    return {
        "id": puzzle_id,
        "level": level,
        "theme": theme,
        "size": size,
        "grid": grid,
        "clues": {"across": across, "down": down},
        "dropped_words": dropped or [],
    }


def _ab(id_: str, level: str, theme: str, words: list[WordClue]) -> dict:
    """Authoring shortcut — runs the auto-builder with level-appropriate caps."""
    cap = {"easy": 11, "medium": 13, "hard": 15, "expert": 17}.get(level, 15)
    return auto_build_crossword(id_, level, theme, words, max_size=cap)


# ════════════════════════════════════════════════════════════════════════
# Word lists — themed, with interlocking shared letters where possible.
# Each list yields a dense puzzle when run through the auto-builder.
# ════════════════════════════════════════════════════════════════════════

# EASY — short, friendly themed words (4-7 letters)
EASY_LISTS: list[tuple[str, str, list[WordClue]]] = [
    ("easy-001", "Garden", [
        ("ROSES",   "Romantic flowers, plural"),
        ("TULIPS",  "Spring bulbs in bright colours"),
        ("LEAVES",  "Found on trees"),
        ("SEEDS",   "What you plant"),
        ("WATER",   "Plants need it daily"),
        ("PLANT",   "Put a seed in the soil"),
        ("HOSE",    "Garden watering tool"),
        ("WEED",    "Unwanted garden visitor"),
    ]),
    ("easy-002", "Cooking", [
        ("BREAD",   "A loaf you bake"),
        ("BUTTER",  "Spread on toast"),
        ("CHEESE",  "Comes in cheddar or brie"),
        ("ROAST",   "Sunday lunch tradition"),
        ("RECIPE",  "Step-by-step cooking guide"),
        ("SUGAR",   "Sweet white granules"),
        ("OVEN",    "Where you bake"),
        ("SPOON",   "Stirring tool"),
    ]),
    ("easy-003", "Weather", [
        ("SUNNY",   "Bright, clear day"),
        ("CLOUDY",  "Overcast sky"),
        ("STORMY",  "Wild and windy"),
        ("RAINBOW", "Arc of colour after rain"),
        ("THUNDER", "Rumbling boom"),
        ("WINDY",   "Breezy day"),
        ("FROST",   "Icy morning coating"),
        ("MIST",    "Light fog"),
    ]),
    ("easy-004", "Pets", [
        ("PUPPY",   "Young dog"),
        ("KITTEN",  "Young cat"),
        ("RABBIT",  "Long-eared hopper"),
        ("HAMSTER", "Wheel-running rodent pet"),
        ("BUDGIE",  "Chatty cage bird"),
        ("PARROT",  "Talking bird"),
        ("FISH",    "Lives in a tank"),
        ("MOUSE",   "Tiny squeaky pet"),
    ]),
    ("easy-005", "Beach", [
        ("WAVES",   "Ocean rollers"),
        ("SANDY",   "Beachy underfoot"),
        ("SHELLS",  "Beach treasures"),
        ("SURFER",  "Wave-rider"),
        ("SUNSET",  "Evening glow over the sea"),
        ("TIDE",    "Sea's daily rise and fall"),
        ("REEF",    "Underwater coral ridge"),
        ("BOAT",    "Floats on water"),
    ]),
    ("easy-006", "Music", [
        ("PIANO",   "88-key instrument"),
        ("GUITAR",  "Strummed with 6 strings"),
        ("MELODY",  "A catchy tune"),
        ("CHORUS",  "Repeating part of a song"),
        ("DRUMS",   "Beaten with sticks"),
        ("BALLAD",  "A slow, story-song"),
        ("NOTE",    "A single musical sound"),
        ("BAND",    "Group of musicians"),
    ]),
    ("easy-007", "Books", [
        ("NOVEL",   "Long story"),
        ("AUTHOR",  "Who writes the book"),
        ("PAGES",   "Sheets you turn"),
        ("LIBRARY", "Borrow books here"),
        ("CHAPTER", "Section of a book"),
        ("STORY",   "Tale being told"),
        ("READ",    "What you do with a book"),
        ("POEM",    "Rhyming writing"),
    ]),
    ("easy-008", "Family", [
        ("MOTHER",  "Mum, formally"),
        ("FATHER",  "Dad, formally"),
        ("SISTER",  "Female sibling"),
        ("COUSIN",  "Aunty's child"),
        ("AUNTIE",  "Mum or dad's sister"),
        ("NANNA",   "Granny, fondly"),
        ("UNCLE",   "Mum or dad's brother"),
        ("BABY",    "Newest family member"),
    ]),
]


# MEDIUM — themed, 5-9 letter words
MEDIUM_LISTS: list[tuple[str, str, list[WordClue]]] = [
    ("medium-001", "Aussie Slang", [
        ("BARBIE",  "BBQ, Aussie style"),
        ("BREKKIE", "Morning meal"),
        ("ESKY",    "Cold drinks carrier"),
        ("ARVO",    "Afternoon"),
        ("COBBER",  "Mate, old slang"),
        ("RIPPER",  "Top notch, beauty"),
        ("DUNNY",   "Outdoor loo"),
        ("CRIKEY",  "Steve Irwin's exclamation"),
        ("SARNIE",  "Sandwich, British/Aussie slang"),
    ]),
    ("medium-002", "Aussie Birds", [
        ("MAGPIE",     "Black-and-white swooper"),
        ("KOOKABURRA", "Laughing kingfisher"),
        ("COCKATOO",   "White sulphur-crested screecher"),
        ("GALAH",      "Pink-and-grey parrot"),
        ("LORIKEET",   "Rainbow-coloured parrot"),
        ("ROSELLA",    "Crimson-headed parrot"),
        ("EMU",        "Flightless Aussie giant"),
        ("KIWI",       "NZ's national bird"),
    ]),
    ("medium-003", "Tea Time", [
        ("TEAPOT",    "Brewing vessel"),
        ("SCONES",    "Cream-tea favourites"),
        ("CRUMPETS",  "Spongy toasted treats"),
        ("BISCUIT",   "Tea-time snack"),
        ("MARMALADE", "Orange preserve"),
        ("CUPPA",     "A nice cup of tea, slang"),
        ("CAKES",     "Sweet baked treats"),
        ("JAM",       "Spread on scones"),
    ]),
    ("medium-004", "Holidays", [
        ("EASTER",    "Chocolate-egg holiday"),
        ("ANZAC",     "Aussie/Kiwi memorial day"),
        ("CHRISTMAS", "December 25 holiday"),
        ("BIRTHDAY",  "Yearly personal celebration"),
        ("NEWYEAR",   "Jan 1 holiday, two words run together"),
        ("HALLOWEEN", "31 October dress-up day"),
        ("DIWALI",    "Hindu festival of lights"),
    ]),
    ("medium-005", "Travel", [
        ("PACKING",  "Filling the suitcase"),
        ("TICKET",   "Boarding pass partner"),
        ("HOTEL",    "Holiday accommodation"),
        ("FLIGHT",   "Plane journey"),
        ("LUGGAGE",  "Suitcases and bags"),
        ("PASSPORT", "Document for going abroad"),
        ("HOLIDAY",  "Time away from work"),
        ("SUITCASE", "Travel bag with wheels"),
    ]),
    ("medium-006", "Sports", [
        ("CRICKET",  "Summer game with bats and stumps"),
        ("TENNIS",   "Net sport with rackets"),
        ("GOLF",     "Played at clubs with greens"),
        ("RUGBY",    "Footy code with oval ball"),
        ("NETBALL",  "Hoops with no backboard"),
        ("BOWLS",    "Older-adult green sport"),
        ("SAILING",  "Wind-powered ocean sport"),
        ("SWIMMING", "Pool laps for fitness"),
    ]),
    ("medium-007", "Around the House", [
        ("KITCHEN",  "Cooking room"),
        ("LOUNGE",   "Sitting room"),
        ("GARDEN",   "Outdoor green space"),
        ("PATIO",    "Outdoor paved area"),
        ("BEDROOM",  "Where you sleep"),
        ("BATHROOM", "Where you bathe"),
        ("GARAGE",   "Where the car lives"),
        ("LAUNDRY",  "Washing-machine room"),
    ]),
    ("medium-008", "Friends & Family", [
        ("FRIENDS",   "Mates"),
        ("FAMILY",    "Loved ones"),
        ("COUSINS",   "Aunty's children"),
        ("GRANDMA",   "Mum's mum"),
        ("GRANDPA",   "Mum's dad"),
        ("NEIGHBOUR", "Person next door"),
        ("BROTHER",   "Male sibling"),
        ("NEPHEW",    "Sibling's son"),
    ]),
]


# HARD — 5-10 letter themed words
HARD_LISTS: list[tuple[str, str, list[WordClue]]] = [
    ("hard-001", "Travel & Adventure", [
        ("PASSPORT",   "Travel document"),
        ("JOURNEY",    "A trip from A to B"),
        ("CONTINENT",  "Major land mass"),
        ("LANDMARK",   "Famous local feature"),
        ("SOUVENIR",   "Holiday keepsake"),
        ("ITINERARY",  "Day-by-day travel plan"),
        ("HOLIDAY",    "Time away"),
        ("ADVENTURE",  "Exciting experience"),
    ]),
    ("hard-002", "Australian Cities", [
        ("BRISBANE",  "QLD capital"),
        ("ADELAIDE",  "SA capital"),
        ("HOBART",    "TAS capital"),
        ("CAIRNS",    "Tropical FNQ city"),
        ("GEELONG",   "Victorian seaside city"),
        ("DARWIN",    "Top End capital"),
        ("PERTH",     "WA capital"),
        ("CANBERRA",  "National capital"),
        ("SYDNEY",    "NSW capital"),
    ]),
    ("hard-003", "Music & Theatre", [
        ("ORCHESTRA", "Symphony ensemble"),
        ("MUSICIAN",  "Player of instruments"),
        ("OPERA",     "Sung dramatic work"),
        ("CONCERT",   "Live music event"),
        ("STAGE",     "Where the show unfolds"),
        ("BALLET",    "Classical dance form"),
        ("SYMPHONY",  "Multi-movement orchestral work"),
        ("AUDIENCE",  "The watchers in seats"),
        ("ENCORE",    "Extra song after applause"),
    ]),
    ("hard-004", "Cooking Up A Storm", [
        ("PAVLOVA",   "Iconic Aussie dessert"),
        ("LAMINGTON", "Sponge dipped in chocolate"),
        ("ROAST",     "Sunday lunch classic"),
        ("DAMPER",    "Campfire bush bread"),
        ("VEGEMITE",  "Salty spread on toast"),
        ("MEATPIE",   "Footy game classic"),
        ("SAUSAGE",   "Snag on the BBQ"),
        ("BARBECUE",  "Outdoor cookout"),
    ]),
    ("hard-005", "Around the World", [
        ("ITALY",   "Land of pasta"),
        ("JAPAN",   "Sushi homeland"),
        ("ENGLAND", "London's country"),
        ("FRANCE",  "Eiffel-tower nation"),
        ("GERMANY", "Land of Oktoberfest"),
        ("SPAIN",   "Land of paella"),
        ("CANADA",  "Maple-leaf country"),
        ("MEXICO",  "Land of tacos"),
        ("GREECE",  "Land of feta and olives"),
    ]),
    ("hard-006", "Nature", [
        ("FORESTS",  "Wooded regions"),
        ("MOUNTAIN", "Tall peak"),
        ("RIVER",    "Flowing waterway"),
        ("ESTUARY",  "Where river meets sea"),
        ("REEF",     "Underwater coral ridge"),
        ("OCEAN",    "Massive body of saltwater"),
        ("DESERT",   "Vast dry sandy area"),
        ("CANYON",   "Deep river-cut valley"),
        ("VOLCANO",  "Lava-spewing mountain"),
    ]),
    ("hard-007", "Sports Across Australia", [
        ("NETBALL",   "Hoops with no backboard"),
        ("SAILING",   "Wind-powered ocean sport"),
        ("BOWLS",     "Older-adult green sport"),
        ("SURFING",   "Catching ocean waves"),
        ("FOOTBALL",  "Soccer, simply"),
        ("CRICKET",   "Summer bat-and-ball game"),
        ("SWIMMING",  "Pool laps for fitness"),
        ("HOCKEY",    "Stick-and-ball field sport"),
    ]),
    ("hard-008", "Classic Movies", [
        ("GODFATHER", "1972 mafia classic, with 'The'"),
        ("GREASE",    "1978 musical with Travolta"),
        ("ROCKY",     "Stallone boxing series"),
        ("BENHUR",    "Chariot-race epic"),
        ("TITANIC",   "1997 shipwreck film"),
        ("JAWS",      "1975 Spielberg shark thriller"),
        ("CASABLANCA","Bogart and Bergman classic"),
        ("AMADEUS",   "1984 Mozart biopic"),
        ("GLADIATOR", "2000 Russell Crowe epic"),
    ]),
]


# EXPERT — denser packs (12-16 themed words each) for tough grids
EXPERT_LISTS: list[tuple[str, str, list[WordClue]]] = [
    ("expert-001", "Community Life", [
        ("COMMUNITY",   "Group of neighbours"),
        ("GATHERING",   "A get-together"),
        ("FELLOWSHIP",  "Bond of friendship"),
        ("VOLUNTEER",   "Helper without pay"),
        ("NEIGHBOUR",   "Person next door"),
        ("TOGETHER",    "United, side by side"),
        ("FRIENDSHIP",  "Strong bond between mates"),
        ("KINDNESS",    "Being warm to others"),
        ("SUPPORT",     "Help and encouragement"),
        ("BELONGING",   "Feeling part of something"),
        ("WELCOME",     "Friendly hello to a newcomer"),
        ("CARING",      "Looking after others"),
        ("LAUGHTER",    "Sound of joy"),
        ("RESPECT",     "Esteem and consideration"),
        ("CHATTER",     "Light talk between friends"),
    ]),
    ("expert-002", "World Capitals", [
        ("CANBERRA",   "Aussie capital"),
        ("WELLINGTON", "Kiwi capital"),
        ("LONDON",     "Capital of England"),
        ("WASHINGTON", "USA capital"),
        ("TOKYO",      "Japan's capital"),
        ("PARIS",      "France's capital"),
        ("BERLIN",     "Germany's capital"),
        ("MADRID",     "Spain's capital"),
        ("ROME",       "Italy's capital"),
        ("OTTAWA",     "Canada's capital"),
        ("DUBLIN",     "Ireland's capital"),
        ("ATHENS",     "Greece's capital"),
        ("VIENNA",     "Austria's capital"),
        ("HELSINKI",   "Finland's capital"),
        ("OSLO",       "Norway's capital"),
        ("LISBON",     "Portugal's capital"),
    ]),
    ("expert-003", "Famous Australians", [
        ("BRADMAN",   "Cricketing knight, surname"),
        ("KIDMAN",    "Nicole, Aussie actress, surname"),
        ("FREEMAN",   "Cathy, Olympic gold runner, surname"),
        ("MENZIES",   "Long-serving PM Robert, surname"),
        ("HUTCHENCE", "Michael, INXS frontman, surname"),
        ("WATSON",    "Common Aussie sport surname"),
        ("CROWE",     "Russell, actor, surname"),
        ("MINOGUE",   "Kylie, pop singer, surname"),
        ("JACKMAN",   "Hugh, Wolverine actor, surname"),
        ("GIBSON",    "Mel, Mad Max actor, surname"),
        ("MURDOCH",   "Rupert, media mogul, surname"),
        ("WHITLAM",   "Reformist PM Gough, surname"),
        ("PACKER",    "Kerry, media boss, surname"),
        ("THORPE",    "Ian, swimmer, surname"),
    ]),
    ("expert-004", "On the Farm", [
        ("PADDOCK",   "Fenced grazing field"),
        ("SHEARING",  "Wool-cutting season"),
        ("WOOLSHED",  "Where the shearing happens"),
        ("LIVESTOCK", "Farm animals"),
        ("HARVEST",   "Crop-gathering time"),
        ("RANCHER",   "Cattle-station owner"),
        ("FARMER",    "The boss of the farm"),
        ("CATTLE",    "Cows, plural"),
        ("TRACTOR",   "Big farm vehicle"),
        ("CHICKENS",  "Egg layers, plural"),
        ("HOMESTEAD", "Farm house"),
        ("OUTBACK",   "Remote Aussie bush country"),
        ("CROPS",     "Wheat, oats and the like"),
        ("STATION",   "Big rural property"),
    ]),
    ("expert-005", "Aussie Cars", [
        ("HOLDEN",     "Aussie car brand, retired 2020"),
        ("MUSTANG",    "Ford pony car"),
        ("VOLKSWAGEN", "German people's car"),
        ("FALCON",     "Iconic Ford Aussie sedan"),
        ("TORANA",     "70s Holden classic"),
        ("MONARO",     "Holden muscle car"),
        ("COMMODORE",  "Long-running Holden sedan"),
        ("KOMBI",      "Hippie van"),
        ("CHARGER",    "70s Valiant muscle car"),
        ("STATESMAN",  "Long-wheelbase Holden flagship"),
        ("CHRYSLER",   "Maker of the Valiant"),
        ("TOYOTA",     "Japanese maker of the Corolla"),
        ("HONDA",      "Japanese maker of the Civic"),
        ("SEDAN",      "Four-door car body style"),
    ]),
    ("expert-006", "Aussie TV Classics", [
        ("NEIGHBOURS",  "Ramsay Street drama"),
        ("HOMEANDAWAY", "Summer Bay soap, run together"),
        ("BLUEHEELERS", "Mt Thomas country cop drama"),
        ("SKIPPY",      "Bush kangaroo TV star"),
        ("PRISONER",    "80s Cell Block H drama"),
        ("COUNTDOWN",   "Molly Meldrum's music show"),
        ("MASTERCHEF",  "Cooking competition show"),
        ("HEYHEY",      "Daryl Somers' long-running variety show"),
        ("PLAYSCHOOL",  "Beloved kids morning show"),
        ("SALEOFTHECENTURY", "Tony Barber game show"),
        ("BACKYARDBLITZ",   "Garden-makeover lifestyle show"),
    ]),
    ("expert-007", "Garden Glory", [
        ("HYDRANGEA",   "Big-bloom hedge plant"),
        ("FRANGIPANI",  "Sweet tropical flower"),
        ("BOTTLEBRUSH", "Red Aussie native shrub"),
        ("WATTLE",      "Yellow national emblem"),
        ("EUCALYPT",    "Gum-tree family name"),
        ("GREVILLEA",   "Native bird-attracting shrub"),
        ("JACARANDA",   "Purple-flowered shade tree"),
        ("BANKSIA",     "Native cone-flower shrub"),
        ("GUMTREE",     "Eucalyptus, two words run together"),
        ("AGAPANTHUS",  "Tall blue-violet flower-head plant"),
        ("MAGNOLIA",    "Big pink-flowered tree"),
        ("CAMELLIA",    "Glossy-leafed flowering shrub"),
        ("LAVENDER",    "Purple aromatic herb"),
        ("ROSEMARY",    "Spiky-leafed kitchen herb"),
    ]),
    ("expert-008", "Holiday Spots", [
        ("GOLDCOAST",   "Surfers Paradise locale"),
        ("BYRONBAY",    "NSW hippie surf town"),
        ("BAROSSA",     "SA wine country"),
        ("KAKADU",      "Top End national park"),
        ("DAINTREE",    "FNQ ancient rainforest"),
        ("ULURU",       "Red-centre monolith"),
        ("WHITSUNDAYS", "Queensland reef islands"),
        ("TASMANIA",    "Island state, south of Vic"),
        ("MELBOURNE",   "Vic capital, sport-mad city"),
        ("FREMANTLE",   "Historic WA port suburb"),
        ("NOOSA",       "Sunshine Coast holiday town"),
        ("PORTDOUGLAS", "FNQ luxe seaside town"),
        ("KANGAROO",    "Island off SA coast (with 'Island')"),
        ("CABLEBEACH",  "Broome's famous white-sand beach"),
    ]),
]


# ────────────────────────────────────────────────────────────────────────
# Build the library at import time. If any puzzle fails to produce ≥4
# words, `auto_build_crossword` raises ValueError — the module fails to
# load, surfacing the problem immediately.
# ────────────────────────────────────────────────────────────────────────
EASY_PUZZLES:   list[dict] = [_ab(id_, "easy",   theme, ws) for id_, theme, ws in EASY_LISTS]
MEDIUM_PUZZLES: list[dict] = [_ab(id_, "medium", theme, ws) for id_, theme, ws in MEDIUM_LISTS]
HARD_PUZZLES:   list[dict] = [_ab(id_, "hard",   theme, ws) for id_, theme, ws in HARD_LISTS]
EXPERT_PUZZLES: list[dict] = [_ab(id_, "expert", theme, ws) for id_, theme, ws in EXPERT_LISTS]


# ────────────────────────────────────────────────────────────────────────
# Library aggregate + rotation
# ────────────────────────────────────────────────────────────────────────
LIBRARY: list[dict] = EASY_PUZZLES + MEDIUM_PUZZLES + HARD_PUZZLES + EXPERT_PUZZLES

PUZZLES_PER_PAGE = 3
ROTATION_DAYS = 14

POINTS_BY_LEVEL = {
    "easy":   5,
    "medium": 10,
    "hard":   15,
    "expert": 25,
}


def _puzzles_by_level(level: str) -> list[dict]:
    return [p for p in LIBRARY if p["level"] == level]


def _current_rotation_window(now: datetime | None = None) -> int:
    if now is None:
        now = datetime.now(timezone.utc)
    anchor = datetime(2026, 1, 1, tzinfo=timezone.utc)
    delta_days = (now - anchor).days
    return max(0, delta_days // ROTATION_DAYS)


def active_puzzles(level: str, now: datetime | None = None) -> list[dict]:
    pool = _puzzles_by_level(level)
    if not pool:
        return []
    window = _current_rotation_window(now)
    start = (window * PUZZLES_PER_PAGE) % len(pool)
    return [pool[(start + i) % len(pool)] for i in range(PUZZLES_PER_PAGE)]


def get_puzzle(puzzle_id: str) -> dict | None:
    return next((p for p in LIBRARY if p["id"] == puzzle_id), None)


def daily_puzzle(now: datetime | None = None) -> dict | None:
    if not MEDIUM_PUZZLES:
        return None
    if now is None:
        now = datetime.now(timezone.utc)
    anchor = datetime(2026, 1, 1, tzinfo=timezone.utc)
    day_index = max(0, (now - anchor).days)
    return MEDIUM_PUZZLES[day_index % len(MEDIUM_PUZZLES)]


def daily_iso_date(now: datetime | None = None) -> str:
    if now is None:
        now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%d")


def levels_summary(now: datetime | None = None) -> list[dict]:
    out = []
    for lvl, label in [("easy", "Easy"), ("medium", "Medium"),
                       ("hard", "Hard"), ("expert", "Expert")]:
        pool = _puzzles_by_level(lvl)
        active = active_puzzles(lvl, now)
        out.append({
            "level": lvl,
            "label": label,
            "size": active[0]["size"] if active else 0,
            "active_count": len(active),
            "library_total": len(pool),
            "points": POINTS_BY_LEVEL.get(lvl, 5),
        })
    return out


def serialise(p: dict, *, with_answers: bool = False) -> dict:
    """Strip the `answer` field from clues + the internal `dropped_words`
    debug field before serving to the client."""
    if with_answers:
        out = {**p}
        out.pop("dropped_words", None)
        return out
    clues_safe = {}
    for dir_, lst in p["clues"].items():
        clues_safe[dir_] = [
            {k: v for k, v in cl.items() if k != "answer"} for cl in lst
        ]
    out = {**p, "clues": clues_safe}
    out.pop("dropped_words", None)
    return out
