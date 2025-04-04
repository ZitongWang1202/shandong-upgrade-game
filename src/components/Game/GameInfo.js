import React from 'react';
import { Box, Text, Flex, Badge, Avatar } from '@chakra-ui/react';
import socket from '../../utils/socket';

function GameInfo({ mainSuit, mainCaller, mainCards, gamePhase, preGameState, isMainFixed, hasCounteredMain }) {
    // 获取当前玩家ID
    const currentPlayerId = socket.id;
    
    // 找出叫主玩家与当前玩家的关系
    const getPlayerRelation = (playerId) => {
        if (playerId === currentPlayerId) {
            return "（我）";
        } else if (playerId) {
            // 简化处理，这里假设ID的最后几位作为名称
            const playerName = `玩家${playerId.slice(0, 4)}`;
            return playerName;
        }
        return "";
    };
    
    return (
        <Box 
            position="absolute" 
            top="10px" 
            left="10px" 
            bg="white" 
            p={3} 
            borderRadius="md" 
            boxShadow="md"
            minW="250px"
        >
            <Text fontWeight="bold" mb={2}>游戏信息</Text>
            
            {mainCaller && (
                <Flex direction="column" gap={2}>
                    {/* 显示叫主玩家信息 */}
                    <Flex align="center" gap={2}>
                        <Text>叫主玩家:</Text>
                        <Badge colorScheme="green">
                            {mainCaller === currentPlayerId 
                                ? `玩家${mainCaller.slice(0, 4)}（我）` 
                                : `玩家${mainCaller.slice(0, 4)}`}
                        </Badge>
                    </Flex>
                    
                    {/* 只有叫主玩家才能看到主花色和牌型 */}
                    {mainCaller === currentPlayerId && mainSuit && (
                        <Text>
                            主花色: {
                                mainSuit === 'HEARTS' ? '♥️' : 
                                mainSuit === 'SPADES' ? '♠️' : 
                                mainSuit === 'DIAMONDS' ? '♦️' : '♣️'
                            }
                        </Text>
                    )}
                    
                    {/* 所有玩家都能看到叫主使用的王 */}
                    {mainCards && (
                        <Text>
                            使用 <strong style={{ color: mainCards.joker === 'BIG' ? 'red' : 'black' }}>
                                {mainCards.joker === 'BIG' ? '大王' : '小王'}
                            </strong> 
                            
                            {/* 只有叫主玩家才能看到完整牌型细节 */}
                            {mainCaller === currentPlayerId && (
                                <> + {
                                    mainCards.pair.suit === 'HEARTS' ? '♥️' : 
                                    mainCards.pair.suit === 'SPADES' ? '♠️' : 
                                    mainCards.pair.suit === 'DIAMONDS' ? '♦️' : '♣️'
                                }<strong>{mainCards.pair.value}</strong></>
                            )} 叫主
                        </Text>
                    )}
                    
                    {/* 显示加固状态 */}
                    {isMainFixed && (
                        <Badge colorScheme="blue">已加固</Badge>
                    )}
                    
                    {/* 显示反主状态 */}
                    {hasCounteredMain && (
                        <Badge colorScheme="red">已反主</Badge>
                    )}
                </Flex>
            )}
        </Box>
    );
}

export default GameInfo;