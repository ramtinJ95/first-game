import { closeTrade } from '../../trade/orders.ts';
import { defineOrder } from '../define-order.ts';

export default defineOrder('closeTrade', closeTrade, undefined);
