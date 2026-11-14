import { openTrade } from '../../trade/orders.ts';
import { defineOrder } from '../define-order.ts';

export default defineOrder('openTrade', openTrade, undefined);
