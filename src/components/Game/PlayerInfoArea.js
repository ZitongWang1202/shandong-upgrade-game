import React from 'react';
import { Box, Text, HStack } from '@chakra-ui/react';
import Card from './Card'; // Assuming Card component is in the same directory or path is adjusted

function PlayerInfoArea({ playersInfo, playedCardsInfo, currentPlayer, mainCaller }) {
    if (!playersInfo || playersInfo.length === 0) {
        return null; // Or some placeholder if no players
    }

    return (
        <>
            {playersInfo.map((player) => {
                if (!player || !player.position) {
                    console.warn("PlayerInfoArea: Rendering skipped for player with incomplete info", player);
                    return null;
                }

                let positionProps = {};
                let playedCardsPositionProps = {};
                let playedCardsAlignment = {};

                switch (player.position) {
                    case 'top':
                        positionProps = { top: "5%", left: "50%", transform: "translateX(-50%)" };
                        playedCardsPositionProps = { top: "calc(5% + 40px + 10px)", left: "50%", transform: "translateX(-50%)", mt: 1 }; // Added a bit more space
                        playedCardsAlignment = { justify: "center" };
                        break;
                    case 'left':
                        positionProps = { top: "50%", left: "3%", transform: "translateY(-50%)" };
                        playedCardsPositionProps = { top: "50%", left: "calc(3% + 80px + 10px)", transform: "translateY(-50%)", ml: 1 }; // Added a bit more space
                        playedCardsAlignment = { align: "center" };
                        break;
                    case 'right':
                        positionProps = { top: "50%", right: "3%", transform: "translateY(-50%)" };
                        playedCardsPositionProps = { top: "50%", right: "calc(3% + 80px + 10px)", transform: "translateY(-50%)", mr: 1 }; // Added a bit more space
                        playedCardsAlignment = { align: "center" };
                        break;
                    case 'bottom': // Current player - their played cards are handled differently or part of ActionPanel potentially
                                   // This component focuses on other players or a unified display of played cards including self.
                                   // For now, let's assume played cards for 'bottom' (self) are also shown here for consistency.
                        playedCardsPositionProps = { bottom: "calc(25% + 20px)", left: "50%", transform: "translateX(-50%)", mb: 1 }; // Positioned above player's hand area
                        playedCardsAlignment = { justify: "center" };
                        break;
                    default:
                        console.warn("PlayerInfoArea: Invalid player position", player.position);
                        return null;
                }

                const cardsPlayed = playedCardsInfo[player.id] || [];

                return (
                    <React.Fragment key={player.id}>
                        {/* Player Name Box (excluding self if position is bottom and we decide not to show nameplate for self) */}
                        {player.position !== 'bottom' && (
                            <Box
                                position="absolute"
                                {...positionProps}
                                bg="rgba(255, 255, 255, 0.7)"
                                p={2}
                                borderRadius="md"
                                minW="70px"
                                zIndex={5} // Ensure above cards if they overlap, but below modals
                            >
                                <Text textAlign="center" fontSize="sm" fontWeight="bold">
                                    {player.name || player.id.slice(0, 6)} {/* Show more of ID if no name */}
                                </Text>
                                {/* Future: Display player score or other info here */}
                            </Box>
                        )}

                        {/* Played Cards Area for each player */}
                        {cardsPlayed.length > 0 && (
                            <HStack
                                position="absolute"
                                {...playedCardsPositionProps}
                                {...playedCardsAlignment}
                                zIndex={10} // Ensure played cards are visible
                                spacing="-25px" // Card overlap
                            >
                                {cardsPlayed.map((card, index) => (
                                    <Card
                                        key={`${card.suit}-${card.value}-${index}`}
                                        suit={card.suit}
                                        value={card.value}
                                        className="played-card small" // Ensure this class is defined for appropriate sizing
                                    />
                                ))}
                            </HStack>
                        )}
                    </React.Fragment>
                );
            })}
        </>
    );
}

export default PlayerInfoArea; 