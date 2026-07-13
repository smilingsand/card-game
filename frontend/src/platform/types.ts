/**
 * 与具体扑克游戏无关的平台基础类型。
 *
 * `Card.id` 表示一张物理牌，而不是它的牌面：同一副或不同副牌中牌面
 * 相同的两张牌也必须使用不同的 ID。
 */
export type CardId = string;
export type PlayerId = string;
export type GameId = string;

export type Suit = "spades" | "hearts" | "diamonds" | "clubs" | "joker";

export type Rank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K"
  | "A"
  | "small-joker"
  | "big-joker";

export interface Card {
  readonly id: CardId;
  readonly deckIndex: number;
  readonly suit: Suit;
  readonly rank: Rank;
}

/** 四人牌桌的固定方向座位；首局由 east 领出。 */
export type Seat = "east" | "south" | "west" | "north";

export type Team = "team-a" | "team-b";

export type ControllerType = "human" | "bot";

export interface Player {
  readonly id: PlayerId;
  readonly seat: Seat;
  readonly team: Team;
  readonly controllerType: ControllerType;
  readonly displayName: string;
}

/** 游戏插件定义具体的动作词表与载荷结构。 */
export interface Action<TPayload = unknown> {
  readonly type: string;
  readonly actorId: PlayerId;
  readonly payload: TPayload;
}

/**
 * 追加到事件流中的平台事件。sequence 由事件流分配，且从 0 开始严格递增。
 */
export interface Event<TPayload = unknown> {
  readonly sequence: number;
  readonly type: string;
  readonly actorId?: PlayerId;
  readonly payload: TPayload;
}
