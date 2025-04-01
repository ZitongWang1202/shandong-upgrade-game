import React from 'react';
import { cardImages } from '../../assets/cardImages';

function Card({ value, suit, className, style }) {
    
    try {
        // 处理大小王
        if (suit === 'JOKER') {
            const imageName = `${value}_JOKER`;
            // console.log('Loading Joker:', imageName);
            return (
                <img 
                    className={className} 
                    alt={`${value === 'BIG' ? '大王' : '小王'}`}
                    src={cardImages[imageName]}
                />
            );
        }
        
        // 处理牌背
        if (suit === 'BACK') {
            return (
                <img 
                    className={className} 
                    alt="card-back" 
                    src={cardImages.BACK}
                />
            );
        }

        // 处理普通牌
        const imageName = `${suit.toUpperCase()}_${value}`;
        // console.log('Loading card:', imageName);
        return (
            <img 
                className={className} 
                alt={`${suit}-${value}`} 
                src={cardImages[imageName]}
            />
        );
    } catch (error) {
        console.error('Error loading card:', error);
        // 加载失败时显示牌背
        return (
            <img 
                className={className} 
                alt="card-back" 
                src={cardImages.BACK}
            />
        );
    }
}

export default Card;