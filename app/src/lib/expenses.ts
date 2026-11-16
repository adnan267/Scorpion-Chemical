import type { IconName } from '@/ui/kit';

export const EXPENSE_TYPES: { value: string; label: string; icon: IconName; hint?: string }[] = [
  { value: 'van', label: 'Wagon / van', icon: 'bus-outline' },
  { value: 'bus', label: 'Bus', icon: 'bus' },
  { value: 'rickshaw', label: 'Rickshaw', icon: 'car-outline' },
  { value: 'chingchi', label: 'Chingchi', icon: 'car-sport-outline' },
  { value: 'bike_fuel', label: 'Bike petrol', icon: 'bicycle-outline' },
  { value: 'food', label: 'Food', icon: 'restaurant-outline' },
  { value: 'stock_carriage', label: 'Stock carriage', icon: 'cube-outline', hint: 'Fare for cartons or an extra seat for stock' },
  { value: 'other', label: 'Other', icon: 'ellipsis-horizontal-circle-outline' },
];

export const OFFICE_EXPENSE_TYPES: { value: string; label: string; icon: IconName }[] = [
  { value: 'electricity', label: 'Electricity bill', icon: 'flash-outline' },
  { value: 'rent', label: 'Rent', icon: 'home-outline' },
  { value: 'salary', label: 'Salary', icon: 'people-outline' },
  { value: 'kitchen', label: 'Kitchen, tea, water', icon: 'cafe-outline' },
  { value: 'utilities', label: 'Gas, phone, internet', icon: 'call-outline' },
  { value: 'office_other', label: 'Other', icon: 'ellipsis-horizontal-circle-outline' },
];
