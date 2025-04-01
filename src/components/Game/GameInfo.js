import React from 'react';
import { Box, Text, Flex, Badge, Avatar } from '@chakra-ui/react';

function GameInfo({ mainSuit, mainCaller, mainCards, players }) {
    // 找到叫主玩家的信息
    const mainCallerInfo = players?.find(p => p.id === mainCaller);
    
    return (
        <Box 
            position="absolute" 
            top="10px" 
            left="10px" 
            bg="white" 
            p={3} 
            borderRadius="md" 
            boxShadow="md"
        >
            <Text fontWeight="bold" mb={2}>游戏信息</Text>
            
            {mainSuit && (
                <Flex direction="column" gap={2}>
                    <Text>
                        主花色: {
                            mainSuit === 'HEARTS' ? '♥️' : 
                            mainSuit === 'SPADES' ? '♠️' : 
                            mainSuit === 'DIAMONDS' ? '♦️' : '♣️'
                        }
                    </Text>
                    
                    {mainCallerInfo && (
                        <Flex align="center" gap={2}>
                            <Text>叫主玩家:</Text>
                            <Badge colorScheme="green">{mainCallerInfo.name}</Badge>
                        </Flex>
                    )}
                    
                    {mainCards && (
                        <Text>
                            叫主牌型: {
                                mainCards.joker === 'BIG' ? '大王' : '小王'
                            } + {
                                mainCards.pair.suit === 'HEARTS' ? '♥️' : 
                                mainCards.pair.suit === 'SPADES' ? '♠️' : 
                                mainCards.pair.suit === 'DIAMONDS' ? '♦️' : '♣️'
                            }{mainCards.pair.value}对
                        </Text>
                    )}
                </Flex>
            )}
        </Box>
    );
}

export default GameInfo;