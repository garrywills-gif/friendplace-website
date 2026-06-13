"""
Curated Australian suburbs dataset — ~250 entries spanning every state/territory's
capital + major regional centres + popular retirement areas.

Each row: (name, postcode, state, lat, lng). Hand-picked for coverage of the
audience YouBelong targets. Easy to extend.
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Tuple


# (name, postcode, state, lat, lng)
SUBURBS: List[Tuple[str, str, str, float, float]] = [
    # ---------- NSW (Sydney & coast) ----------
    ("Sydney",            "2000", "NSW", -33.8688, 151.2093),
    ("Bondi",             "2026", "NSW", -33.8915, 151.2767),
    ("Bondi Beach",       "2026", "NSW", -33.8908, 151.2743),
    ("Manly",             "2095", "NSW", -33.7969, 151.2871),
    ("Mosman",            "2088", "NSW", -33.8276, 151.2403),
    ("Surry Hills",       "2010", "NSW", -33.8857, 151.2105),
    ("Newtown",           "2042", "NSW", -33.8975, 151.1789),
    ("Paddington",        "2021", "NSW", -33.8849, 151.2280),
    ("Glebe",             "2037", "NSW", -33.8794, 151.1879),
    ("Chatswood",         "2067", "NSW", -33.7969, 151.1832),
    ("Parramatta",        "2150", "NSW", -33.8150, 151.0011),
    ("Hornsby",           "2077", "NSW", -33.7036, 151.0993),
    ("Cronulla",          "2230", "NSW", -34.0567, 151.1525),
    ("Hurstville",        "2220", "NSW", -33.9676, 151.1031),
    ("Penrith",           "2750", "NSW", -33.7506, 150.6944),
    ("Liverpool",         "2170", "NSW", -33.9200, 150.9258),
    ("Bankstown",         "2200", "NSW", -33.9173, 151.0337),
    ("Blacktown",         "2148", "NSW", -33.7711, 150.9057),
    ("Campbelltown",      "2560", "NSW", -34.0658, 150.8141),
    ("Wollongong",        "2500", "NSW", -34.4278, 150.8931),
    ("Newcastle",         "2300", "NSW", -32.9283, 151.7817),
    ("Coffs Harbour",     "2450", "NSW", -30.2963, 153.1135),
    ("Port Macquarie",    "2444", "NSW", -31.4310, 152.9089),
    ("Byron Bay",         "2481", "NSW", -28.6474, 153.6020),
    ("Ballina",           "2478", "NSW", -28.8635, 153.5645),
    ("Tweed Heads",       "2485", "NSW", -28.1764, 153.5380),
    ("Albury",            "2640", "NSW", -36.0737, 146.9135),
    ("Bathurst",          "2795", "NSW", -33.4193, 149.5775),
    ("Orange",            "2800", "NSW", -33.2839, 149.1011),
    ("Dubbo",             "2830", "NSW", -32.2400, 148.6048),
    ("Wagga Wagga",       "2650", "NSW", -35.1082, 147.3598),
    ("Tamworth",          "2340", "NSW", -31.0905, 150.9295),
    ("Armidale",          "2350", "NSW", -30.5025, 151.6650),
    ("Lismore",           "2480", "NSW", -28.8083, 153.2776),
    ("Goulburn",          "2580", "NSW", -34.7544, 149.6177),
    ("Nowra",             "2541", "NSW", -34.8770, 150.6020),
    ("Maitland",          "2320", "NSW", -32.7314, 151.5586),
    ("Cessnock",          "2325", "NSW", -32.8316, 151.3552),

    # ---------- VIC ----------
    ("Melbourne",         "3000", "VIC", -37.8136, 144.9631),
    ("Carlton",           "3053", "VIC", -37.8003, 144.9670),
    ("Fitzroy",           "3065", "VIC", -37.7984, 144.9786),
    ("St Kilda",          "3182", "VIC", -37.8676, 144.9810),
    ("South Yarra",       "3141", "VIC", -37.8404, 144.9930),
    ("Toorak",            "3142", "VIC", -37.8418, 145.0140),
    ("Brunswick",         "3056", "VIC", -37.7670, 144.9610),
    ("Footscray",         "3011", "VIC", -37.7997, 144.8997),
    ("Brighton",          "3186", "VIC", -37.9070, 144.9999),
    ("Hawthorn",          "3122", "VIC", -37.8214, 145.0357),
    ("Frankston",         "3199", "VIC", -38.1413, 145.1226),
    ("Dandenong",         "3175", "VIC", -37.9874, 145.2147),
    ("Box Hill",          "3128", "VIC", -37.8197, 145.1217),
    ("Glen Waverley",     "3150", "VIC", -37.8783, 145.1647),
    ("Mornington",        "3931", "VIC", -38.2151, 145.0383),
    ("Geelong",           "3220", "VIC", -38.1499, 144.3617),
    ("Ballarat",          "3350", "VIC", -37.5622, 143.8503),
    ("Bendigo",           "3550", "VIC", -36.7570, 144.2794),
    ("Shepparton",        "3630", "VIC", -36.3833, 145.4000),
    ("Warrnambool",       "3280", "VIC", -38.3818, 142.4847),
    ("Mildura",           "3500", "VIC", -34.1880, 142.1583),
    ("Wodonga",           "3690", "VIC", -36.1216, 146.8881),
    ("Traralgon",         "3844", "VIC", -38.1958, 146.5407),
    ("Sale",              "3850", "VIC", -38.1110, 147.0640),
    ("Bairnsdale",        "3875", "VIC", -37.8266, 147.6113),

    # ---------- QLD ----------
    ("Brisbane",          "4000", "QLD", -27.4698, 153.0251),
    ("Fortitude Valley",  "4006", "QLD", -27.4570, 153.0345),
    ("West End",          "4101", "QLD", -27.4831, 153.0107),
    ("South Brisbane",    "4101", "QLD", -27.4796, 153.0204),
    ("Toowong",           "4066", "QLD", -27.4854, 152.9893),
    ("New Farm",          "4005", "QLD", -27.4660, 153.0500),
    ("Indooroopilly",     "4068", "QLD", -27.4994, 152.9722),
    ("Chermside",         "4032", "QLD", -27.3852, 153.0303),
    ("Sunnybank",         "4109", "QLD", -27.5814, 153.0531),
    ("Logan Central",     "4114", "QLD", -27.6429, 153.1093),
    ("Ipswich",           "4305", "QLD", -27.6168, 152.7610),
    ("Caboolture",        "4510", "QLD", -27.0808, 152.9510),
    ("Redcliffe",         "4020", "QLD", -27.2306, 153.1117),
    ("Gold Coast",        "4217", "QLD", -28.0023, 153.4145),
    ("Surfers Paradise",  "4217", "QLD", -28.0023, 153.4145),
    ("Broadbeach",        "4218", "QLD", -28.0290, 153.4310),
    ("Burleigh Heads",    "4220", "QLD", -28.0918, 153.4503),
    ("Robina",            "4226", "QLD", -28.0734, 153.3909),
    ("Southport",         "4215", "QLD", -27.9665, 153.4156),
    ("Sunshine Coast",    "4558", "QLD", -26.6500, 153.0667),
    ("Maroochydore",      "4558", "QLD", -26.6586, 153.0915),
    ("Noosa Heads",       "4567", "QLD", -26.3982, 153.0928),
    ("Caloundra",         "4551", "QLD", -26.7993, 153.1320),
    ("Mooloolaba",        "4557", "QLD", -26.6810, 153.1196),
    ("Hervey Bay",        "4655", "QLD", -25.2837, 152.8326),
    ("Bundaberg",         "4670", "QLD", -24.8661, 152.3489),
    ("Gladstone",         "4680", "QLD", -23.8430, 151.2652),
    ("Rockhampton",       "4700", "QLD", -23.3781, 150.5100),
    ("Mackay",            "4740", "QLD", -21.1417, 149.1860),
    ("Townsville",        "4810", "QLD", -19.2589, 146.8169),
    ("Cairns",            "4870", "QLD", -16.9186, 145.7781),
    ("Mount Isa",         "4825", "QLD", -20.7257, 139.4927),
    ("Toowoomba",         "4350", "QLD", -27.5598, 151.9507),

    # ---------- WA ----------
    ("Perth",             "6000", "WA", -31.9505, 115.8605),
    ("Fremantle",         "6160", "WA", -32.0569, 115.7439),
    ("Subiaco",           "6008", "WA", -31.9472, 115.8267),
    ("Cottesloe",         "6011", "WA", -31.9952, 115.7574),
    ("Scarborough",       "6019", "WA", -31.8930, 115.7547),
    ("Joondalup",         "6027", "WA", -31.7448, 115.7661),
    ("Rockingham",        "6168", "WA", -32.2774, 115.7297),
    ("Mandurah",          "6210", "WA", -32.5269, 115.7218),
    ("Bunbury",           "6230", "WA", -33.3267, 115.6398),
    ("Busselton",         "6280", "WA", -33.6512, 115.3437),
    ("Margaret River",    "6285", "WA", -33.9551, 115.0747),
    ("Albany",            "6330", "WA", -35.0269, 117.8836),
    ("Geraldton",         "6530", "WA", -28.7774, 114.6147),
    ("Kalgoorlie",        "6430", "WA", -30.7489, 121.4669),
    ("Broome",            "6725", "WA", -17.9617, 122.2359),
    ("Karratha",          "6714", "WA", -20.7368, 116.8458),

    # ---------- SA ----------
    ("Adelaide",          "5000", "SA", -34.9285, 138.6007),
    ("North Adelaide",    "5006", "SA", -34.9082, 138.5994),
    ("Glenelg",           "5045", "SA", -34.9799, 138.5152),
    ("Norwood",           "5067", "SA", -34.9213, 138.6300),
    ("Henley Beach",      "5022", "SA", -34.9171, 138.4924),
    ("Marion",            "5043", "SA", -35.0118, 138.5560),
    ("Modbury",           "5092", "SA", -34.8333, 138.6886),
    ("Salisbury",         "5108", "SA", -34.7587, 138.6388),
    ("Elizabeth",         "5112", "SA", -34.7191, 138.6712),
    ("Gawler",            "5118", "SA", -34.5985, 138.7449),
    ("Mount Barker",      "5251", "SA", -35.0667, 138.8667),
    ("Murray Bridge",     "5253", "SA", -35.1191, 139.2747),
    ("Victor Harbor",     "5211", "SA", -35.5571, 138.6164),
    ("Port Lincoln",      "5606", "SA", -34.7264, 135.8576),
    ("Whyalla",           "5600", "SA", -33.0317, 137.5817),
    ("Port Augusta",      "5700", "SA", -32.4904, 137.7615),
    ("Mount Gambier",     "5290", "SA", -37.8294, 140.7831),

    # ---------- TAS ----------
    ("Hobart",            "7000", "TAS", -42.8821, 147.3272),
    ("Sandy Bay",         "7005", "TAS", -42.9056, 147.3320),
    ("Glenorchy",         "7010", "TAS", -42.8369, 147.2680),
    ("Kingston",          "7050", "TAS", -42.9762, 147.3072),
    ("Launceston",        "7250", "TAS", -41.4332, 147.1441),
    ("Devonport",         "7310", "TAS", -41.1809, 146.3522),
    ("Burnie",            "7320", "TAS", -41.0561, 145.9050),

    # ---------- ACT ----------
    ("Canberra",          "2600", "ACT", -35.2809, 149.1300),
    ("Civic",             "2601", "ACT", -35.2802, 149.1310),
    ("Belconnen",         "2617", "ACT", -35.2378, 149.0673),
    ("Tuggeranong",       "2900", "ACT", -35.4202, 149.0926),
    ("Woden",             "2606", "ACT", -35.3450, 149.0890),
    ("Gungahlin",         "2912", "ACT", -35.1857, 149.1339),

    # ---------- NT ----------
    ("Darwin",            "0800", "NT", -12.4634, 130.8456),
    ("Palmerston",        "0830", "NT", -12.4853, 130.9836),
    ("Alice Springs",     "0870", "NT", -23.6980, 133.8807),
    ("Katherine",         "0850", "NT", -14.4669, 132.2647),
]


def search_suburbs(q: str, limit: int = 10) -> List[Dict]:
    """Substring + prefix match across name and postcode, ranked."""
    if not q:
        return []
    needle = q.strip().lower()
    if not needle:
        return []
    scored: List[Tuple[int, Dict]] = []
    for name, postcode, state, lat, lng in SUBURBS:
        n_lower = name.lower()
        score = -1
        if n_lower.startswith(needle):
            score = 0
        elif postcode.startswith(needle):
            score = 1
        elif needle in n_lower:
            score = 2
        elif n_lower in needle:
            score = 3
        if score >= 0:
            scored.append((score, {"name": name, "postcode": postcode, "state": state, "lat": lat, "lng": lng}))
    scored.sort(key=lambda x: (x[0], x[1]["name"]))
    return [s[1] for s in scored[:limit]]


def by_postcode(postcode: str) -> List[Dict]:
    """All suburbs sharing a postcode (often multiple)."""
    return [
        {"name": n, "postcode": p, "state": s, "lat": la, "lng": lg}
        for n, p, s, la, lg in SUBURBS if p == postcode
    ]


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distance in km between two lat/lng pairs."""
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))
