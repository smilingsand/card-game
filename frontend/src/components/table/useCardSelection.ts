import { useCallback, useEffect, useState } from "react";

export function useCardSelection(ownHandCardIds: readonly string[] = []) {
  const [selectedCardIds, setSelectedCardIds] = useState<readonly string[]>([]);
  useEffect(() => {
    const ownHand = new Set(ownHandCardIds);
    setSelectedCardIds((current) => {
      const valid = current.filter((cardId) => ownHand.has(cardId));
      return valid.length === current.length ? current : valid;
    });
  }, [ownHandCardIds]);
  const clearSelection = useCallback(() => setSelectedCardIds([]), []);
  const toggleCard = useCallback((cardId: string, allowMultiple: boolean) => {
    setSelectedCardIds((current) => {
      if (current.includes(cardId)) return current.filter((id) => id !== cardId);
      return allowMultiple ? [...current, cardId] : [cardId];
    });
  }, []);
  return { selectedCardIds, setSelectedCardIds, clearSelection, toggleCard };
}
