// The reward items a Weekly Award is built from: the four King's Chests, the four resources
// and Any Resource.
// The game fixes them. The weekly_award_item.item check constraint and valid_reward_items (supabase/migrations)
// hold the same ids, so adding an item means changing both.
export const REWARD_ITEMS = [
  { id: "chest-legendary", name: "Legendary Chest", icon: "assets/rewards/chest-legendary.png", kind: "chest" },
  { id: "chest-epic", name: "Epic Chest", icon: "assets/rewards/chest-epic.png", kind: "chest" },
  { id: "chest-elite", name: "Elite Chest", icon: "assets/rewards/chest-elite.png", kind: "chest" },
  { id: "chest-advanced", name: "Advanced Chest", icon: "assets/rewards/chest-advanced.png", kind: "chest" },
  { id: "rss-food", name: "Food", icon: "assets/rewards/rss-food.png", kind: "resource" },
  { id: "rss-wood", name: "Wood", icon: "assets/rewards/rss-wood.png", kind: "resource" },
  { id: "rss-stone", name: "Stone", icon: "assets/rewards/rss-stone.png", kind: "resource" },
  { id: "rss-gold", name: "Gold", icon: "assets/rewards/rss-gold.png", kind: "resource" },
  // The winner picks which resource they receive.
  { id: "rss-any", name: "Any Resource", icon: "assets/rewards/rss-any.png", kind: "resource" },
];

export const rewardItem = (id) => REWARD_ITEMS.find((x) => x.id === id);
