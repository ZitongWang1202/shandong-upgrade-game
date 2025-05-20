import React from 'react';
import { Box, Button, VStack, Text, HStack } from '@chakra-ui/react';
import Card from './Card'; // For displaying leading play cards

function ActionPanel({
    gamePhase,
    isMyTurn,
    onPlayCards,
    isPlayButtonDisabled,
    preGameState,
    onConfirmBottomDeal,
    leadingPlay,
    isFirstPlayerInRound,
    playersInfo,
    currentPlayer,
    socketId
}) {
    return (
        <VStack 
            position="absolute" 
            top="60%" // Adjust as needed, this was a common position for these controls
            left="50%" 
            transform="translate(-50%, -50%)" 
            spacing={4} 
            zIndex={15} // Ensure it's above other elements like PlayerInfoArea played cards if they overlap
        >
            {/* Game Phase: Playing */}
            {gamePhase === 'playing' && (
                <>
                    {isMyTurn ? (
                        <>
                            <Text fontSize="xl" fontWeight="bold" color="yellow.300">
                                {isFirstPlayerInRound ? "轮到你领牌!" : "轮到你跟牌!"}
                            </Text>
                            {!isFirstPlayerInRound && leadingPlay && leadingPlay.cards && (
                                <Box textAlign="center" bg="rgba(0,0,0,0.5)" p={1} borderRadius="md">
                                    <Text fontSize="sm" color="white">跟牌 ({leadingPlay.cards.length}张):</Text>
                                    <HStack justify="center" spacing="-15px" mt={1}>
                                        {leadingPlay.cards.map((card, index) => (
                                            <Card 
                                                key={`lead-${card.suit}-${card.value}-${index}`}
                                                suit={card.suit} 
                                                value={card.value} 
                                                className="played-card small" 
                                            />
                                        ))}
                                    </HStack>
                                </Box>
                            )}
                            <Button colorScheme="blue" onClick={onPlayCards} isDisabled={isPlayButtonDisabled}>
                                出牌
                            </Button>
                        </>
                    ) : (
                        <Text fontSize="xl" fontWeight="bold" color="gray.400">
                            等待 {playersInfo?.find(p => p.id === currentPlayer)?.name || '玩家'} 出牌...
                        </Text>
                    )}
                </>
            )}

            {/* Game Phase: Bottom Deal (for the dealer) */}
            {gamePhase === 'bottomDeal' && preGameState.isBottomDealer && (
                 <Box textAlign="center" bg="rgba(255,255,255,0.9)" p={4} borderRadius="md" boxShadow="lg">
                    <Text fontWeight="bold" mb={2}>请选择4张牌放入底牌：</Text>
                    <VStack align="center" spacing={2} mb={4}>
                        <HStack><Text>已选择 {preGameState.selectedBottomCards.length}/4 张牌</Text>{preGameState.selectedBottomCards.length === 4 && (<Text color="green.500" ml={2}>✓</Text>)}</HStack>
                    </VStack>
                    <Button colorScheme="green" onClick={onConfirmBottomDeal} isDisabled={preGameState.selectedBottomCards.length !== 4} width="100%">
                        确认放底
                    </Button>
                    {preGameState.bottomDealTimeLeft !== null && (
                        <Text mt={2} textAlign="center" color={preGameState.bottomDealTimeLeft <= 5 ? "red.500" : "gray.500"}>
                            {preGameState.bottomDealTimeLeft}秒
                        </Text>
                    )}
                </Box>
            )}
            
            {/* Future: Add other action buttons here if needed, e.g., Stick cards UI could partially move here */}
            {/* Example: Stick phase buttons for current player if they are the main caller and need to select cards for sticking */}
            {preGameState.isStickPhase && preGameState.mainCaller === socketId && !preGameState.hasStickCards && (
                 <Box textAlign="center" bg="rgba(255,255,255,0.9)" p={4} borderRadius="md" boxShadow="lg">
                    <Text fontWeight="bold" mb={2}>选择要交换的牌（粘主）：</Text>
                    <VStack align="start" spacing={1} mb={3}>
                        <HStack><Text fontSize="sm">1. 先选一张常主或固定常主 (2/3/5)</Text>{preGameState.selectedCardsForSticking.commonMain && (<Text color="green.500" ml={1}>✓</Text>)}</HStack>
                        <HStack><Text fontSize="sm">2. 再选两张主花色牌</Text>{preGameState.selectedCardsForSticking.suitCards.length === 2 && (<Text color="green.500" ml={1}>✓</Text>)}</HStack>
                    </VStack>
                    {/* This button would be in GameLayout and call handleConfirmStickCards */}
                    {/* <Button colorScheme="green" onClick={onConfirmStickCards} isDisabled={!preGameState.selectedCardsForSticking.commonMain || preGameState.selectedCardsForSticking.suitCards.length !== 2} width="100%">确认交换</Button> */}
                    {preGameState.mainCallerCardsForSticking && (
                        <Box mt={3} pt={2} borderTopWidth="1px">
                            <Text fontSize="sm" fontWeight="bold" mb={1}>你的原叫主牌：</Text>
                            <HStack spacing={1} justify="center">
                                {preGameState.mainCallerCardsForSticking.map((card, index) => (<Card key={`stick-orig-${index}`} suit={card.suit} value={card.value} className="small" />))}
                            </HStack>
                        </Box>
                    )}
                     {preGameState.stickMainTimeLeft !== null && (
                        <Text mt={2} textAlign="center" fontSize="sm" color={preGameState.stickMainTimeLeft <= 5 ? "red.500" : "gray.500"}>
                            剩余时间: {preGameState.stickMainTimeLeft}秒
                        </Text>
                    )}
                </Box>
            )}

        </VStack>
    );
}

export default ActionPanel; 