import React from 'react';
import { Center } from '@chakra-ui/react';
import Card from './Card';
import '../../cards.css'; // Assuming common card styles are here

function PlayerHandDisplay({
    playerCards,
    selectedCards,
    onCardSelect,
    onCardInteraction,
    gamePhase,
    preGameState,
    cardSelectionValidator,
    socketId
}) {
    if (!playerCards) {
        return null;
    }

    // Sort cards before rendering if not already sorted (though GameLayout usually sorts them)
    // const displayCards = sortCards(playerCards, preGameState.mainSuit, preGameState.commonMain);
    // Decided to trust GameLayout to pass sorted playerCards

    return (
        <Center position="absolute" bottom="5%" left="50%" transform="translateX(-50%)" maxW="90vw" overflow="visible">
            <div className="player-hand">
                {playerCards.map((card, index) => {
                    const cardKey = `${card.suit}-${card.value}-${index}`;
                    
                    // Determine if the card is selected based on the game phase
                    let isSelected;
                    if (gamePhase === 'bottomDeal' && preGameState.isBottomDealer) {
                        isSelected = preGameState.selectedBottomCards.some(c => {
                            const selectedIndex = playerCards.findIndex(pc => pc === c);
                            return selectedIndex === index;
                        });
                    } else if (preGameState.isStickPhase && preGameState.mainCaller === socketId && !preGameState.hasStickCards) {
                        isSelected = (preGameState.selectedCardsForSticking.commonMain?.suit === card.suit && preGameState.selectedCardsForSticking.commonMain?.value === card.value) ||
                                     preGameState.selectedCardsForSticking.suitCards.some(sc => sc.suit === card.suit && sc.value === card.value);
                    }
                    else {
                        isSelected = selectedCards.some(c => {
                            const selectedIndex = playerCards.findIndex(pc => pc === c);
                            return selectedIndex === index;
                        });
                    }

                    // Determine if the card can be selected
                    let canSelect;
                    if (gamePhase === 'bottomDeal' && preGameState.isBottomDealer) {
                        canSelect = preGameState.selectedBottomCards.length < 4 || isSelected;
                    } else if (preGameState.isStickPhase && preGameState.mainCaller === socketId && !preGameState.hasStickCards) {
                        // Simplified stick phase selection logic, assuming validator handles specific rules
                        // This part might need refinement based on how stick selection is validated
                        canSelect = true; // Placeholder - actual validation might be complex
                    } else if (gamePhase === 'playing') {
                        canSelect = cardSelectionValidator ? (cardSelectionValidator(card, selectedCards) || isSelected) : true;
                    } else {
                        canSelect = false; // Default to not selectable if no specific phase matches
                    }

                    const isFromBottom = card.isFromBottom && Array.isArray(preGameState.cardsFromBottom) && preGameState.cardsFromBottom.includes(`${card.suit}-${card.value}`);
                    const hasInteracted = preGameState.interactedBottomCards instanceof Set && preGameState.interactedBottomCards.has(`${card.suit}-${card.value}-${index}`);
                    
                    return (
                        <div
                            key={cardKey}
                            className={`card-container ${isSelected ? 'selected' : ''} ${!canSelect && !isSelected ? 'disabled' : ''}`}
                            onClick={() => {
                                if (onCardSelect) onCardSelect(card);
                                if (onCardInteraction) onCardInteraction(card); // May want to separate click from general interaction
                            }}
                            onMouseEnter={() => {
                                if (onCardInteraction) onCardInteraction(card);
                            }}
                        >
                            <Card 
                                suit={card.suit} 
                                value={card.value} 
                                className={`player-card ${isFromBottom && !hasInteracted ? 'from-bottom' : ''}`} 
                                isMainCard={preGameState.mainSuit && (card.suit === preGameState.mainSuit || card.value === preGameState.commonMain || card.suit === 'JOKER')} // Pass isMainCard prop
                            />
                        </div>
                    );
                })}
            </div>
        </Center>
    );
}

export default PlayerHandDisplay; 