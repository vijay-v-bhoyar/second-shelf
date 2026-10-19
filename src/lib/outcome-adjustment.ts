import type {Outcome} from "./types";
export function adjustmentValues(outcomes:Outcome[],parentId:string,quantity:number){
  const parent=outcomes.find(o=>o.id===parentId&&o.type==="purchase");if(!parent)throw new Error("Choose the original purchase first.");
  if(!Number.isInteger(quantity)||quantity<1||quantity>100)throw new Error("Enter a whole quantity from 1 to 100.");
  const events=outcomes.filter(o=>o.parentEventId===parent.id&&o.type!=="purchase"),remainingQuantity=parent.quantity-events.reduce((n,o)=>n+o.quantity,0),remainingAmount=parent.amountMinor-events.reduce((n,o)=>n+o.amountMinor,0);
  return{parent,amountMinor:quantity===remainingQuantity?remainingAmount:Math.floor(parent.amountMinor*quantity/parent.quantity)};
}
