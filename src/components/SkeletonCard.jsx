import React from 'react';

const SkeletonCard = () => (
  <div className="product-card skeleton" style={{ pointerEvents: 'none' }}>
    <div style={{ width: '100%', aspectRatio: '16/9', background: '#eee', borderRadius: '12px', marginBottom: '15px' }}></div>
    <div style={{ height: '20px', background: '#eee', borderRadius: '4px', width: '70%', margin: '0 auto 10px auto' }}></div>
    <div style={{ height: '24px', background: '#eee', borderRadius: '4px', width: '40%', margin: '0 auto 15px auto' }}></div>
    <div style={{ height: '40px', background: '#eee', borderRadius: '8px', width: '100%' }}></div>
  </div>
);

export default SkeletonCard;
