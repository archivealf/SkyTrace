(() => {
  "use strict";

  // Common ICAO airline callsign prefixes. The map never depends on this list:
  // unknown operators receive a deterministic two-colour livery automatically.
  const AIRLINES = {
    BAW:{name:"British Airways",code:"BA",slug:"britishairways",primary:"#075AAA",secondary:"#D71920"},
    CFE:{name:"BA CityFlyer",code:"CJ",slug:"britishairways",primary:"#075AAA",secondary:"#D71920"},
    EZY:{name:"easyJet",code:"U2",slug:"easyjet",primary:"#FF6600",secondary:"#FFFFFF"},
    EJU:{name:"easyJet Europe",code:"EC",slug:"easyjet",primary:"#FF6600",secondary:"#FFFFFF"},
    RYR:{name:"Ryanair",code:"FR",slug:"ryanair",primary:"#073590",secondary:"#F1C933"},
    RUK:{name:"Ryanair UK",code:"RK",slug:"ryanair",primary:"#073590",secondary:"#F1C933"},
    VIR:{name:"Virgin Atlantic",code:"VS",slug:"virginatlantic",primary:"#D50000",secondary:"#5C2D91"},
    TOM:{name:"TUI Airways",code:"BY",slug:"tui",primary:"#70CBF4",secondary:"#D40E14"},
    EXS:{name:"Jet2",code:"LS",slug:"jet2",primary:"#D71920",secondary:"#123A6D"},
    LOG:{name:"Loganair",code:"LM",slug:"",primary:"#1428A0",secondary:"#FFFFFF"},
    AUR:{name:"Aurigny",code:"GR",slug:"",primary:"#F3C300",secondary:"#153E7E"},

    DLH:{name:"Lufthansa",code:"LH",slug:"lufthansa",primary:"#05164D",secondary:"#FFAD00"},
    EWG:{name:"Eurowings",code:"EW",slug:"eurowings",primary:"#6F2C91",secondary:"#00A3E0"},
    GWI:{name:"Eurowings",code:"EW",slug:"eurowings",primary:"#6F2C91",secondary:"#00A3E0"},
    CFG:{name:"Condor",code:"DE",slug:"condor",primary:"#FFD700",secondary:"#1F6E46"},
    AFR:{name:"Air France",code:"AF",slug:"airfrance",primary:"#002157",secondary:"#E31B23"},
    HOP:{name:"Air France Hop",code:"A5",slug:"airfrance",primary:"#002157",secondary:"#E31B23"},
    KLM:{name:"KLM",code:"KL",slug:"klm",primary:"#00A1DE",secondary:"#FFFFFF"},
    SWR:{name:"SWISS",code:"LX",slug:"swiss",primary:"#D71920",secondary:"#FFFFFF"},
    AUA:{name:"Austrian Airlines",code:"OS",slug:"austrianairlines",primary:"#D81E05",secondary:"#FFFFFF"},
    BEL:{name:"Brussels Airlines",code:"SN",slug:"brusselsairlines",primary:"#C8102E",secondary:"#1D1D1B"},
    SAS:{name:"SAS",code:"SK",slug:"sas",primary:"#00195C",secondary:"#D7E4EC"},
    FIN:{name:"Finnair",code:"AY",slug:"finnair",primary:"#003580",secondary:"#FFFFFF"},
    IBE:{name:"Iberia",code:"IB",slug:"iberia",primary:"#D71920",secondary:"#F9B000"},
    VLG:{name:"Vueling",code:"VY",slug:"vueling",primary:"#FFCC00",secondary:"#5A5A5A"},
    TAP:{name:"TAP Air Portugal",code:"TP",slug:"tapairportugal",primary:"#007A33",secondary:"#D22630"},
    EIN:{name:"Aer Lingus",code:"EI",slug:"aerlingus",primary:"#006272",secondary:"#58C800"},
    WZZ:{name:"Wizz Air",code:"W6",slug:"wizzair",primary:"#C6007E",secondary:"#00AEEF"},
    LOT:{name:"LOT Polish Airlines",code:"LO",slug:"lotpolishairlines",primary:"#1B365D",secondary:"#FFFFFF"},
    ICE:{name:"Icelandair",code:"FI",slug:"icelandair",primary:"#001B71",secondary:"#F4B223"},
    BTI:{name:"airBaltic",code:"BT",slug:"airbaltic",primary:"#A8CE38",secondary:"#1B4C3B"},
    NAX:{name:"Norwegian",code:"DY",slug:"norwegian",primary:"#D81920",secondary:"#FFFFFF"},
    NBT:{name:"Norse Atlantic",code:"N0",slug:"",primary:"#142B5F",secondary:"#E5332A"},
    AEE:{name:"Aegean Airlines",code:"A3",slug:"aegeanairlines",primary:"#0054A6",secondary:"#78BCE8"},
    PGT:{name:"Pegasus Airlines",code:"PC",slug:"pegasusairlines",primary:"#F7C900",secondary:"#D71920"},
    THY:{name:"Turkish Airlines",code:"TK",slug:"turkishairlines",primary:"#C70A0C",secondary:"#FFFFFF"},

    UAE:{name:"Emirates",code:"EK",slug:"emirates",primary:"#D71921",secondary:"#FFFFFF"},
    QTR:{name:"Qatar Airways",code:"QR",slug:"qatarairways",primary:"#5C0632",secondary:"#8A1538"},
    ETD:{name:"Etihad Airways",code:"EY",slug:"etihadairways",primary:"#BD8B13",secondary:"#5B3A29"},
    SIA:{name:"Singapore Airlines",code:"SQ",slug:"singaporeairlines",primary:"#13294B",secondary:"#F5A623"},
    CPA:{name:"Cathay Pacific",code:"CX",slug:"cathaypacific",primary:"#006564",secondary:"#FFFFFF"},
    ANA:{name:"ANA",code:"NH",slug:"ana",primary:"#003399",secondary:"#29A9E1"},
    JAL:{name:"Japan Airlines",code:"JL",slug:"japanairlines",primary:"#D70000",secondary:"#FFFFFF"},
    KAL:{name:"Korean Air",code:"KE",slug:"koreanair",primary:"#4B9CD3",secondary:"#D71920"},
    AAR:{name:"Asiana Airlines",code:"OZ",slug:"asianaairlines",primary:"#8A1538",secondary:"#C6A15B"},
    CCA:{name:"Air China",code:"CA",slug:"airchina",primary:"#D71920",secondary:"#1B365D"},
    CES:{name:"China Eastern",code:"MU",slug:"chinaeasternairlines",primary:"#005BAC",secondary:"#E31B23"},
    CSN:{name:"China Southern",code:"CZ",slug:"chinaSouthernairlines",primary:"#008ACB",secondary:"#E31B23"},
    EVA:{name:"EVA Air",code:"BR",slug:"evaair",primary:"#008C95",secondary:"#2B9B57"},
    CAL:{name:"China Airlines",code:"CI",slug:"chinaairlines",primary:"#7A6AA6",secondary:"#E5B4C8"},
    MAS:{name:"Malaysia Airlines",code:"MH",slug:"malaysiaairlines",primary:"#003B70",secondary:"#D71920"},
    AXM:{name:"AirAsia",code:"AK",slug:"airasia",primary:"#E31B23",secondary:"#FFFFFF"},

    AAL:{name:"American Airlines",code:"AA",slug:"americanairlines",primary:"#0078D2",secondary:"#C8102E"},
    DAL:{name:"Delta Air Lines",code:"DL",slug:"delta",primary:"#071D49",secondary:"#C8102E"},
    UAL:{name:"United Airlines",code:"UA",slug:"unitedairlines",primary:"#005DAA",secondary:"#FFFFFF"},
    SWA:{name:"Southwest Airlines",code:"WN",slug:"southwestairlines",primary:"#304CB2",secondary:"#F9B612"},
    JBU:{name:"JetBlue",code:"B6",slug:"jetblue",primary:"#003876",secondary:"#00AEEF"},
    ASA:{name:"Alaska Airlines",code:"AS",slug:"alaskaairlines",primary:"#01426A",secondary:"#7BAFD4"},
    FFT:{name:"Frontier Airlines",code:"F9",slug:"frontierairlines",primary:"#0B7A41",secondary:"#FFFFFF"},
    NKS:{name:"Spirit Airlines",code:"NK",slug:"spiritairlines",primary:"#FFD100",secondary:"#111111"},
    ACA:{name:"Air Canada",code:"AC",slug:"aircanada",primary:"#D8292F",secondary:"#111111"},
    WJA:{name:"WestJet",code:"WS",slug:"westjet",primary:"#005EB8",secondary:"#00A651"},
    AMX:{name:"Aeromexico",code:"AM",slug:"aeromexico",primary:"#001E62",secondary:"#E31B23"},
    CMP:{name:"Copa Airlines",code:"CM",slug:"copaairlines",primary:"#003B71",secondary:"#B5A36A"},
    AVA:{name:"Avianca",code:"AV",slug:"avianca",primary:"#E31B23",secondary:"#FFFFFF"},
    LAN:{name:"LATAM Airlines",code:"LA",slug:"latamairlines",primary:"#2E2D85",secondary:"#E91E63"},
    TAM:{name:"LATAM Brasil",code:"JJ",slug:"latamairlines",primary:"#2E2D85",secondary:"#E91E63"},

    QFA:{name:"Qantas",code:"QF",slug:"qantas",primary:"#E0001B",secondary:"#FFFFFF"},
    VOZ:{name:"Virgin Australia",code:"VA",slug:"virginaustralia",primary:"#D50032",secondary:"#7A1E75"},
    ANZ:{name:"Air New Zealand",code:"NZ",slug:"airnewzealand",primary:"#111111",secondary:"#FFFFFF"},

    UPS:{name:"UPS Airlines",code:"5X",slug:"ups",primary:"#351C15",secondary:"#FFB500"},
    FDX:{name:"FedEx Express",code:"FX",slug:"fedex",primary:"#4D148C",secondary:"#FF6600"},
    CLX:{name:"Cargolux",code:"CV",slug:"",primary:"#0072BC",secondary:"#E31B23"},
    BOX:{name:"AeroLogic",code:"3S",slug:"",primary:"#EF3340",secondary:"#2B2B2B"},
    BCS:{name:"European Air Transport",code:"QY",slug:"dhl",primary:"#FFCC00",secondary:"#D40511"}
  };

  const FALLBACK_PALETTES = [
    ["#35D0FF", "#DCEBFA"], ["#7C6CFF", "#E4DEFF"], ["#FF6B8A", "#FFE0E8"],
    ["#34D399", "#D1FAE5"], ["#F59E0B", "#FEF3C7"], ["#0EA5E9", "#BAE6FD"],
    ["#F97316", "#FFEDD5"], ["#8B5CF6", "#EDE9FE"], ["#14B8A6", "#CCFBF1"],
    ["#E11D48", "#FFE4E6"], ["#2563EB", "#DBEAFE"], ["#65A30D", "#ECFCCB"]
  ];

  function hashCode(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function callsignPrefix(callsign) {
    const raw = String(callsign || "").trim().toUpperCase();
    const three = raw.match(/^[A-Z]{3}/)?.[0];
    if (three) return three;
    const letters = raw.match(/^[A-Z]{2,3}/)?.[0];
    return letters || "";
  }

  window.SKYTRACE_AIRLINES = AIRLINES;
  window.skytraceAirlineFor = function skytraceAirlineFor(callsign) {
    const raw = String(callsign || "").trim().toUpperCase();
    const prefix = callsignPrefix(raw);
    const known = AIRLINES[prefix];
    if (known) return { ...known, icao: prefix, known: true };

    const identity = prefix || raw.slice(0, 3) || "GEN";
    const palette = FALLBACK_PALETTES[hashCode(identity) % FALLBACK_PALETTES.length];
    const looksLikeRegistration = /^(N\d|G[A-Z0-9]|D[A-Z0-9]|F[A-Z0-9]|EC[A-Z0-9]|PH[A-Z0-9]|HB[A-Z0-9])/.test(raw);
    return {
      name: looksLikeRegistration ? "Private / General Aviation" : (prefix ? `Operator ${prefix}` : "Unknown operator"),
      code: looksLikeRegistration ? "GA" : (prefix || "GA"),
      slug: "",
      primary: palette[0],
      secondary: palette[1],
      icao: prefix,
      known: false
    };
  };
})();
