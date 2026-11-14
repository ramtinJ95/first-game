import { cancelBuilding } from '../../buildings/build.ts';
import { defineOrder } from '../define-order.ts';

export default defineOrder('cancelBuilding', cancelBuilding, undefined);
