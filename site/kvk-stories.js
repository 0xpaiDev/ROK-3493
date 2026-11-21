// The Season of Conquest Stories a KvK can be: name, Camps (names, in the game's order), poster (portrait,
// the admin wizard's cards) and key art (widescreen, the KvK tab's banner). Art © Lilith Games, copied into
// assets/kvk-stories/ from the game's data (research/rok-kvk-research.md, "Season of Conquest stories").
// The game fixes them and a new one comes every year or two. The kvk.story check constraint
// (supabase/migrations) holds the same slugs, so adding a Story means changing both.
const story = (slug, name, camps) => ({
  slug, name, camps,
  poster: `assets/kvk-stories/${slug}-poster.webp`,
  art: `assets/kvk-stories/${slug}-art.webp`,
});
const ELEMENTS = ["Fire Camp", "Earth Camp", "Wind Camp", "Water Camp"];
const SIX = [...ELEMENTS, "Greenwood Camp", "Daybreak Camp"];

export const KVK_STORIES = [
  story("heroic-anthem", "Heroic Anthem", ELEMENTS),
  story("strife-of-the-eight", "Strife of the Eight", [...SIX, "Midnight Camp", "Thunderbolt Camp"]),
  story("desert-conquest", "Desert Conquest", ELEMENTS),
  story("king-of-the-nile", "King of the Nile", ["Camp Horus", "Camp Seth"]),
  story("siege-of-orleans", "Siege of Orléans", ["Brittany", "Picardy", "Bourbon", "Auvergne", "La Marche", "Poitou"]),
  story("warriors-unbound", "Warriors Unbound", SIX),
  story("storm-of-stratagems", "Storm of Stratagems", SIX),
  story("tides-of-war", "Tides of War", ELEMENTS),
  story("alliance-invictus", "Alliance Invictus", SIX),
  story("keener-blades", "Keener Blades", SIX),
  story("shifting-gears", "Shifting Gears", ELEMENTS),
  story("king-of-all-britain", "King of All Britain", ["Northumbria", "East Anglia", "Wessex", "Mercia"]),
  story("song-of-troy", "Song of Troy", ["Aeolia", "Dardania", "Lycia", "Mycenae"]),
  story("mighty-assembly", "Mighty Assembly", ELEMENTS),
];

export const kvkStory = (slug) => KVK_STORIES.find((s) => s.slug === slug) ?? null;
